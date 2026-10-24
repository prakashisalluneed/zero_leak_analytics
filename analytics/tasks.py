import logging
import re
import time

import numpy as np
from celery import shared_task
from django.utils import timezone

from . import sandbox
from .analysis import (
    AnalysisError,
    build_code_prompt,
    build_format_prompt,
    chart_payload,
    contradicts_table,
    format_history,
    get_llm,
    is_truncated,
    load_dataframe,
    profile_dataframe,
    result_numbers,
    strip_markdown,
    tokenize,
    unsupported_numbers,
    unwrap_result,
)
from .models import ChatMessage, ChatSession, Dataset, UsageEvent

logger = logging.getLogger('analytics.tasks')


def clean_generated_code(code_str: str) -> str:
    """Strip Markdown fences and conversational wrappers so the string is pure Python."""
    if not code_str:
        return ''

    pattern = r"```(?:python|py)?\s*([\s\S]*?)\s*```"
    match = re.search(pattern, code_str, re.IGNORECASE)
    if match:
        code_str = match.group(1)

    lines = []
    for line in code_str.strip().splitlines():
        stripped = line.strip()
        if stripped.startswith('```'):
            continue
        # Drop prose the model sometimes prepends despite instructions.
        if stripped.startswith(('Here', 'This code', 'Sure,', 'The following')):
            continue
        lines.append(line)

    return '\n'.join(lines).strip()


@shared_task(bind=True, name='analytics.run_dataset_analysis')
def run_dataset_analysis(self, session_id, question, user_id, history=None):
    """Load → prompt → sandbox-execute → format, reporting progress as it goes.

    ``history`` is supplied by the caller; when omitted the conversation is read from
    the database so a retried task still has context.
    """
    started = time.perf_counter()
    task_id = self.request.id
    tokens: list[str] = []
    chart = None

    logger.info(
        'analysis.start task=%s session=%s user=%s question=%r',
        task_id, session_id, user_id, (question or '')[:200],
    )

    def publish(stage, include_chart=True):
        meta = {'stage': stage, 'tokens': list(tokens), 'user_id': user_id}
        if include_chart:
            meta['chart'] = chart
        try:
            self.update_state(state='PROGRESS', meta=meta)
        except Exception:  # telemetry must never break the analysis
            logger.debug('analysis.publish_failed task=%s', task_id, exc_info=True)

    # Every exit path needs to persist the assistant turn exactly once.
    session = (
        ChatSession.objects.filter(pk=session_id, user_id=user_id).first()
        if user_id is not None
        else None
    )
    if session is None:
        logger.warning('analysis.session_missing task=%s session=%s', task_id, session_id)
        return {'ok': False, 'user_id': user_id, 'error': 'Conversation not found.',
                'code': 'not_found'}

    # Defense in depth: the dataset must belong to the same user as the session.
    dataset = Dataset.objects.filter(pk=session.dataset_id, user_id=user_id).first()
    if dataset is None:
        return {'ok': False, 'user_id': user_id, 'error': 'Dataset not found.',
                'code': 'not_found'}

    try:
        publish('loading_data')
        step = time.perf_counter()
        df = load_dataframe(dataset.file.path)
        # `column_schema` stores the column list only; the prompt builder expects the
        # whole profile, so wrap it, and fall back to reading the frame if it is empty
        # (datasets uploaded before profiling existed).
        if dataset.column_schema:
            profile = {
                'row_count': dataset.row_count,
                'column_count': dataset.column_count,
                'columns': dataset.column_schema,
                'truncated': dataset.truncated,
            }
        else:
            profile = profile_dataframe(df)
        logger.info(
            'analysis.data_loaded task=%s rows=%d cols=%d elapsed=%.3fs',
            task_id, len(df), len(df.columns), time.perf_counter() - step,
        )

        if history is None:
            prior = session.messages.exclude(content='').order_by('-created_at')[:12]
            history = [
                {'role': m.role, 'content': m.content}
                for m in reversed(list(prior))
            ]

        llm = get_llm()

        publish('generating_code')
        step = time.perf_counter()
        raw_code = llm.invoke(build_code_prompt(profile, format_history(history), question)).strip()
        logger.info('analysis.code_generated task=%s elapsed=%.3fs', task_id, time.perf_counter() - step)

        cleaned_code = clean_generated_code(raw_code)
        logger.debug('analysis.code task=%s code=%r', task_id, cleaned_code)

        publish('executing')
        step = time.perf_counter()

        if not cleaned_code:
            # Some models answer a greeting conversationally instead of emitting code.
            result = {'chat_reply': raw_code.strip()[:2_000] or 'I could not produce an analysis for that.'}
        else:
            result, cleaned_code = _execute_with_repair(llm, df, profile, history, question, cleaned_code)

        logger.info('analysis.executed task=%s elapsed=%.3fs', task_id, time.perf_counter() - step)

        # A `{value, method}` envelope is presentation metadata, not data.
        result, method_note = unwrap_result(result)

        if isinstance(result, dict) and 'chat_reply' in result:
            answer = str(result['chat_reply'])
            for token in tokenize(answer):
                tokens.append(token)
                publish('writing', include_chart=False)
        else:
            chart = chart_payload(result)
            table = None if chart else _table_for(result)
            publish('writing')
            step = time.perf_counter()

            if chart:
                # A chart is self-explanatory; a short caption beats a rewritten table.
                answer = _chart_caption(question, chart)
                for token in tokenize(answer):
                    tokens.append(token)
                    publish('writing')
            else:
                try:
                    for chunk in llm.stream(build_format_prompt(question, result)):
                        if not chunk:
                            continue
                        tokens.append(chunk)
                        publish('writing')
                    answer = strip_markdown(''.join(tokens).strip())
                except Exception:
                    logger.warning('analysis.format_failed task=%s', task_id, exc_info=True)
                    answer = ''

                # Verify the prose against the computation it claims to describe.
                # A local 8B model will occasionally restate a figure it was never
                # given; when that happens the computed table is more trustworthy
                # than the sentence, so the sentence is replaced.
                if answer:
                    invented = unsupported_numbers(answer, result_numbers(result))
                    mispaired = contradicts_table(answer, result)
                    if invented or mispaired:
                        logger.warning(
                            'analysis.answer_unverified task=%s invented=%s mispaired=%s answer=%r',
                            task_id, invented, mispaired, answer[:200],
                        )
                        answer = _fallback_answer(result)
                        tokens.clear()
                        tokens.extend(tokenize(answer))
                        publish('writing')

                if not answer:
                    answer = _fallback_answer(result)

            logger.info('analysis.formatted task=%s elapsed=%.3fs', task_id, time.perf_counter() - step)

        elapsed = time.perf_counter() - started
        payload = {
            'ok': True,
            'user_id': user_id,
            'answer': answer,
            'chart': chart,
            'elapsed': round(elapsed, 3),
        }
        if method_note:
            # How the model derived a metric that was not a column. Surfaced next
            # to the answer so the assumption is visible rather than implied.
            payload['method'] = method_note
        # The snippet is returned so the UI can show its work on request.
        payload['code'] = cleaned_code
        if not chart:
            table = _table_for(result)
            if table:
                payload['table'] = table
        if is_truncated(df):
            payload['truncated'] = True

        assistant = ChatMessage.objects.create(
            session=session,
            role=ChatMessage.ASSISTANT,
            content=answer,
            chart=chart,
            method=method_note[:300],
            code=(cleaned_code or '')[:4000],
            elapsed_ms=int(elapsed * 1000),
        )
        ChatSession.objects.filter(pk=session.pk).update(updated_at=timezone.now())
        Dataset.objects.filter(pk=dataset.pk).update(last_analyzed_at=timezone.now())
        UsageEvent.record(
            session.user, 'analysis.run',
            dataset_id=dataset.pk, session_id=session.pk,
            elapsed_ms=int(elapsed * 1000), chart=bool(chart),
        )

        payload['message_id'] = assistant.pk
        logger.info(
            'analysis.success task=%s session=%s elapsed=%.3fs tokens=%d chart=%s',
            task_id, session_id, elapsed, len(tokens), bool(chart),
        )
        return payload

    except AnalysisError as exc:
        logger.error(
            'analysis.rejected task=%s session=%s code=%s error=%s elapsed=%.3fs',
            task_id, session_id, exc.code, exc, time.perf_counter() - started, exc_info=True,
        )
        _record_failure(session, exc)
        return {'ok': False, 'user_id': user_id, 'error': str(exc), 'code': exc.code}

    except Exception as exc:
        logger.exception(
            'analysis.crashed task=%s session=%s error=%s elapsed=%.3fs',
            task_id, session_id, exc, time.perf_counter() - started,
        )
        _record_failure(
            session,
            AnalysisError('The analysis failed while running. Please try again.', code='server_error'),
        )
        raise


def _execute_with_repair(llm, df, profile, history, question, code, attempts=2):
    """Run the snippet, and on a runtime error let the model repair it once.

    Local models produce plausible-but-broken pandas fairly often (a datetime
    conversion on a categorical column, a renamed aggregation). Re-prompting with
    the exact error is far cheaper than asking the person to rephrase, and it is
    still bounded: at most ``attempts`` repairs, and the sandbox policy is applied
    to every revision exactly as before.

    Returns ``(result, final_code)``.
    """
    last_error = None

    for attempt in range(attempts + 1):
        try:
            return sandbox.execute(code, df), code
        except sandbox.SandboxViolation as exc:
            # A policy violation is not a bug to repair: refuse it outright.
            raise AnalysisError(str(exc), code=exc.code) from exc
        except sandbox.ExecutionTimeout as exc:
            raise AnalysisError(
                'The analysis took too long and was stopped. Try a narrower question.',
                code='timeout',
            ) from exc
        except Exception as exc:
            last_error = exc
            logger.info(
                'analysis.execution_retry attempt=%d error=%s', attempt + 1, exc,
            )
            if attempt >= attempts:
                break

            repair_prompt = (
                f'{build_code_prompt(profile, format_history(history), question)}\n\n'
                'Your previous answer raised this error when it ran:\n'
                f'{type(exc).__name__}: {exc}\n\n'
                'Here was your previous code:\n'
                f'{code}\n\n'
                'Return corrected Python only. Fix the cause of that error; do not '
                'change the intent of the analysis.'
            )
            try:
                repaired = clean_generated_code(llm.invoke(repair_prompt))
            except Exception:
                logger.warning('analysis.repair_failed', exc_info=True)
                break
            if not repaired:
                break
            code = repaired

    raise AnalysisError(
        f'Could not compute the answer: {last_error}', code='execution_error'
    ) from last_error


def _record_failure(session, exc):
    try:
        ChatMessage.objects.create(
            session=session,
            role=ChatMessage.ASSISTANT,
            error=str(exc),
        )
    except Exception:  # pragma: no cover - defensive
        logger.exception('analysis.failure_not_persisted session=%s', session.pk)


def _table_for(result):
    from .analysis import table_payload

    return table_payload(result)


def _chart_caption(question, chart):
    """A one-line caption for a chart, derived from the payload (no model call)."""
    rows = chart.get('chart_data') or []
    kind = chart.get('chart_type', 'chart')
    if not rows:
        return 'The query returned no data to plot.'
    columns = list(rows[0].keys())
    if len(columns) >= 2:
        return f'This {kind} chart plots {columns[1]} by {columns[0]} across {len(rows)} points.'
    return f'This {kind} chart shows {columns[0]} across {len(rows)} points.'


def _fallback_answer(result):
    """A truthful description built only from the computed value.

    Used when the formatting call fails, returns nothing, or states a figure that
    the computation never produced. It is deliberately plain: it reports what was
    computed, and lets the table carry the detail.
    """
    import pandas as pd

    # Normalise a numpy array (the shape `.values[0]` produces) to nested lists
    # before the list handling below can misread it as a flat list of values.
    if isinstance(result, np.ndarray):
        result = result.tolist()

    if isinstance(result, pd.DataFrame):
        if result.empty:
            return 'The query returned no matching rows.'
        if len(result) == 1 and len(result.columns) <= 3:
            record = result.iloc[0]
            parts = [f'{column}: {_format_value(value)}' for column, value in record.items()]
            return 'The computed result is ' + '; '.join(parts) + '.'
        return (
            f'The computation returned a table of {len(result)} rows across '
            f'{len(result.columns)} columns, shown below.'
        )

    if isinstance(result, pd.Series):
        if result.empty:
            return 'The query returned no matching values.'
        if len(result) == 1:
            return f'The computed value is {_format_value(result.iloc[0])}.'
        return f'The computation returned {len(result)} values, shown below.'

    if isinstance(result, (list, tuple)):
        if not result:
            return 'The query returned no matching values.'
        if len(result) == 1 and isinstance(result[0], (list, tuple)):
            # A single record: ".values[0]" on a one-row frame yields this shape.
            return 'The computed result is ' + ', '.join(
                _format_value(value) for value in result[0]
            ) + '.'
        if len(result) == 1:
            return f'The computed value is {_format_value(result[0])}.'

        # A flat label/value pair — `.values[0]` on a one-row frame with a text
        # column — reads as "Gadget: 42.00", not as a list of two values.
        labels = [item for item in result if isinstance(item, str)]
        numbers = [item for item in result if isinstance(item, (int, float)) and not isinstance(item, bool)]
        if len(labels) == 1 and len(numbers) == 1 and len(result) == 2:
            return f'The computed result is {labels[0]}: {_format_value(numbers[0])}.'

        if all(isinstance(item, (str, int, float)) for item in result):
            shown = ', '.join(_format_value(item) for item in result[:6])
            more = '' if len(result) <= 6 else f' and {len(result) - 6} more'
            return f'The computed values are {shown}{more}.'
        return f'The computation returned {len(result)} values, shown below.'

    if isinstance(result, dict):
        if not result:
            return 'The computation produced no output.'
        parts = [f'{key}: {_format_value(value)}' for key, value in list(result.items())[:8]]
        return 'The computed result is ' + '; '.join(parts) + '.'

    return f'The computed value is {_format_value(result)}.'


def _format_value(value):
    """Render a scalar for prose without inventing precision."""
    import pandas as pd

    try:
        if pd.isna(value):
            return 'not available'
    except (TypeError, ValueError):
        pass
    if isinstance(value, bool):
        return 'yes' if value else 'no'
    if isinstance(value, float):
        if value.is_integer():
            return f'{int(value):,}'
        return f'{value:,.2f}'
    if isinstance(value, int):
        return f'{value:,}'
    return str(value)
