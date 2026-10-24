"""Analysis pipeline helpers: dataset profiling, prompting, and result shaping.

This module holds no Django model imports so the pipeline can be exercised without a
database. It does read two settings via ``django.conf.settings``; that import is safe
outside a configured app for the helpers that do not touch it.
"""
from __future__ import annotations

import json
import os
import re
from decimal import Decimal

import pandas as pd
from langchain_ollama import OllamaLLM

# --- Limits -----------------------------------------------------------------

MAX_ROWS = 200_000
MAX_COLUMNS = 500
MAX_FILE_BYTES = 25 * 1024 * 1024
SCHEMA_PROMPT_CHARS = 8_000
SAMPLE_VALUES_PER_COLUMN = 3

ALLOWED_EXTENSIONS = ('.csv', '.xlsx')

_LLM = None


class AnalysisError(Exception):
    """Expected, user-facing failure (bad input, ownership, unsupported file, unsafe code)."""

    def __init__(self, message, code='error'):
        super().__init__(message)
        self.code = code


class FileRejected(AnalysisError):
    """The uploaded file cannot be accepted."""


def get_llm(model=None, temperature=0.0, timeout=90.0):
    """Return a cached chat model. The client never leaves the host network."""
    global _LLM
    if _LLM is None:
        from django.conf import settings as dj_settings

        _LLM = OllamaLLM(
            model=model or getattr(dj_settings, 'OLLAMA_MODEL', 'llama3.1'),
            base_url=getattr(dj_settings, 'OLLAMA_BASE_URL', None) or None,
            timeout=timeout,
            temperature=temperature,
        )
    return _LLM


def reset_llm():
    """Drop the cached client. Used by tests and after a model change in settings."""
    global _LLM
    _LLM = None


# --- File handling ----------------------------------------------------------


def validate_upload(file_obj):
    """Reject an upload before anything is written. Raises FileRejected."""
    if file_obj is None:
        raise FileRejected('No file was uploaded.', code='missing_file')

    name = getattr(file_obj, 'name', '') or ''
    extension = os.path.splitext(name)[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise FileRejected(
            'Unsupported file type. Upload a .csv or .xlsx file.', code='unsupported_type'
        )

    size = getattr(file_obj, 'size', None)
    if size is not None and size > MAX_FILE_BYTES:
        raise FileRejected(
            f'This file is larger than the {MAX_FILE_BYTES // (1024 * 1024)} MB limit.',
            code='file_too_large',
        )
    if size is not None and size == 0:
        raise FileRejected('The uploaded file is empty.', code='empty_file')
    return extension


def load_dataframe(file_path):
    """Read a CSV/Excel file into a frame, applying row and column caps."""
    extension = os.path.splitext(file_path)[1].lower()
    if extension == '.csv':
        df = pd.read_csv(file_path, nrows=MAX_ROWS + 1, low_memory=False)
    elif extension == '.xlsx':
        df = pd.read_excel(file_path, nrows=MAX_ROWS + 1)
    else:
        raise AnalysisError('Unsupported file type', code='unsupported_type')

    if len(df.columns) > MAX_COLUMNS:
        raise AnalysisError(
            f'This file has {len(df.columns)} columns; the limit is {MAX_COLUMNS}.',
            code='too_many_columns',
        )

    truncated = len(df) > MAX_ROWS
    if truncated:
        df = df.head(MAX_ROWS)

    # Attach the truncation flag without polluting the user-visible schema.
    object.__setattr__(df, '_zla_truncated', truncated)
    return df


def is_truncated(df):
    return bool(getattr(df, '_zla_truncated', False))


def _json_scalar(value):
    """Render a sample cell as JSON-safe text for the schema payload."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (int, float, bool, str)):
        return value
    return str(value)[:120]


def profile_dataframe(df):
    """Describe a frame without exposing it wholesale: shape, dtypes, null counts."""
    columns = []
    for name in df.columns:
        series = df[name]
        try:
            unique_count = int(series.nunique(dropna=True))
        except (TypeError, ValueError):
            unique_count = None

        samples = []
        try:
            for value in series.dropna().head(SAMPLE_VALUES_PER_COLUMN).tolist():
                samples.append(_json_scalar(value))
        except Exception:  # pragma: no cover - defensive for odd dtypes
            samples = []

        columns.append({
            'name': str(name),
            'dtype': str(series.dtype),
            'nullable': bool(series.isna().any()),
            'null_count': int(series.isna().sum()),
            'unique_count': unique_count,
            'sample': samples,
        })

    return {
        'row_count': int(len(df)),
        'column_count': int(len(df.columns)),
        'columns': columns,
        'truncated': is_truncated(df),
    }


def schema_str(df, profile=None):
    """Render the schema sent to the model. Column names and dtypes only."""
    if profile is None:
        profile = profile_dataframe(df)

    parts = [f'{col["name"]}: {col["dtype"]}' for col in profile['columns']]
    text = ', '.join(parts)
    if len(text) > SCHEMA_PROMPT_CHARS:
        text = text[:SCHEMA_PROMPT_CHARS] + ', …'
    return text


def column_reference(profile):
    """A compact, human-readable column listing used to steer the model."""
    return '\n'.join(
        f"- {col['name']} ({col['dtype']})"
        for col in profile['columns'][:80]
    )


# --- Prompting --------------------------------------------------------------


def format_history(history):
    """Render prior turns for context. Only user questions and final answers."""
    if not history:
        return ''
    lines = ['CONVERSATION SO FAR:']
    for message in history[-6:]:
        role = 'User' if message.get('role') == 'user' else 'Assistant'
        content = (message.get('content') or '').strip()
        if not content:
            continue
        lines.append(f'{role}: {content[:600]}')
    return '\n'.join(lines) + '\n\n'


CODE_PROMPT = """You are a careful pandas analyst. You have a dataframe named `df`.
Columns:
{columns}

{history}QUESTION: {question}

Write Python that computes the answer and assigns it to `result`.
Rules:
- Use only `df`, `pd`, and plain Python. No imports, no file access, no printing.
- Keep `result` small: a scalar, a short string, or at most 50 rows.
- For a table answer, assign a pandas DataFrame or a list of dicts.
- For a chart, assign `result = {{"chart_type": "bar", "chart_data": <dataframe>}}`
  choosing the best of bar, line, pie, area, scatter.
- If the question is a greeting or unrelated to the data, assign
  `result = {{"chat_reply": "<a brief, friendly reply>"}}`.
- Only call `pd.to_datetime` on a column that genuinely contains dates. Labels
  like "Q1", "2024-Q3", "FY24", or product codes are categories: group them as
  strings in the order they appear.
- Use `errors="coerce"` if you do convert, and never let a failed conversion
  abort the analysis.
- Guard against empty selections; the simplest correct code is best.
- If the question names a metric that is not a column (for example "revenue" when
  the table has `units` and `price`), derive it with the most literal formula and
  record that choice: assign
  `result = {{"value": <answer>, "method": "revenue = units * price"}}`.
  Never guess an aggregate that spans more than one column without saying so.

Reply with Python code only. No markdown fences, no explanation."""

FORMAT_PROMPT = """You write one short answer for a person who asked a question about
their data. The numbers have already been computed for you.

Question: {question}

COMPUTED RESULT (this is the only source of truth):
{result}

Rules:
- Copy figures from the computed result exactly, character for character — same
  row order, same column, same number. Never pair a label with a value from a
  different row. When several rows are present, say what the table shows rather
  than enumerating them: the reader can see the table.
- Answer the question in 1-2 sentences of plain prose. No preamble.
- Never use markdown: no tables, no pipe characters, no bullet lists, no bold, no
  headings. The interface already displays the underlying table or chart beneath
  your sentence.
- Do not mention Python, code, variables, dataframes, or how the value was computed.
- If the result is empty, say plainly that no matching rows were found."""


def build_code_prompt(profile, history_text, question):
    return CODE_PROMPT.format(
        columns=column_reference(profile),
        history=history_text,
        question=question,
    )


def build_format_prompt(question, result):
    return FORMAT_PROMPT.format(question=question, result=_result_text(result))


def _result_text(result, limit=4_000):
    """Render a computed value for the formatting prompt, bounded in size."""
    if isinstance(result, pd.DataFrame):
        text = result.head(50).to_string(index=False)
    elif isinstance(result, pd.Series):
        text = result.head(50).to_string()
    elif isinstance(result, dict):
        text = json.dumps(result, default=str)[:limit]
    else:
        text = str(result)
    return text[:limit]


# --- Result shaping ---------------------------------------------------------


def _json_default(obj):
    """Coerce numpy/pandas scalars so payloads survive the JSON result backend."""
    if isinstance(obj, (pd.Timestamp,)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if hasattr(obj, 'item'):
        try:
            return obj.item()
        except Exception:
            pass
    if isinstance(obj, (set, tuple)):
        return list(obj)
    if hasattr(obj, 'to_dict'):
        try:
            return obj.to_dict(orient='records')
        except Exception:
            pass
    return str(obj)


def unwrap_result(result):
    """Extract the payload from a ``{"value": …, "method": …}`` envelope.

    The prompt asks the model to record how it derived a metric that is not a
    column. That envelope is presentation metadata, not data: the UI shows a plain
    value and, when present, the stated method alongside the answer.
    """
    if isinstance(result, dict) and 'value' in result and 'method' in result:
        return result['value'], str(result.get('method') or '')
    if isinstance(result, dict) and 'value' in result and len(result) == 1:
        return result['value'], ''
    return result, ''


def chart_payload(result):
    """Return a JSON-safe chart dict, or None if the result is not a chart."""
    if not (isinstance(result, dict) or hasattr(result, 'to_dict')):
        return None

    try:
        data = dict(result) if isinstance(result, dict) else result.to_dict()
    except Exception:
        return None

    if 'chart_type' not in data:
        return None

    chart_data = data.get('chart_data')
    if isinstance(chart_data, pd.DataFrame):
        frame = chart_data.head(200).copy()
        for column in frame.columns:
            if pd.api.types.is_datetime64_any_dtype(frame[column]):
                frame[column] = frame[column].astype(str)
        data['chart_data'] = frame.fillna(0).to_dict(orient='records')
    elif isinstance(chart_data, pd.Series):
        frame = chart_data.head(200).reset_index()
        data['chart_data'] = frame.fillna(0).to_dict(orient='records')
    elif not isinstance(chart_data, (list, tuple)) or not chart_data:
        return None

    allowed_types = {'bar', 'line', 'pie', 'area', 'scatter'}
    chart_type = str(data.get('chart_type', 'bar')).lower()
    data['chart_type'] = chart_type if chart_type in allowed_types else 'bar'

    try:
        return json.loads(json.dumps(data, default=_json_default))
    except (TypeError, ValueError):
        return None


def _normalise_frame(frame):
    """Give a frame readable column names and plain dtypes for the UI.

    An unnamed Series (``df.groupby('product').apply(...)``) reset to a frame
    produces a column literally named ``0``; naming it is the difference between a
    table that reads and one that does not.
    """
    frame = frame.copy()

    # integer / unhelpful column names
    renamed = {}
    for column in frame.columns:
        if isinstance(column, (int, float)) or (isinstance(column, str) and column.isdigit()):
            renamed[column] = 'value'
        elif isinstance(column, tuple):
            # A MultiIndex grouping produces tuple labels; join them readably.
            renamed[column] = ' / '.join(str(part) for part in column if part not in ('', None))
        elif column is None or (isinstance(column, str) and not column.strip()):
            renamed[column] = 'value'
    if renamed:
        frame = frame.rename(columns=renamed)

    # Replace remaining non-string column names with their text form.
    frame.columns = [str(column) for column in frame.columns]

    for column in frame.columns:
        if pd.api.types.is_datetime64_any_dtype(frame[column]):
            frame[column] = frame[column].astype(str)

    return frame


def contradicts_table(text, result):
    """True when the prose pairs a table row's label with a figure from elsewhere.

    A local model sometimes sorts or reshuffles the table while writing, then
    describes row *i* using row *j*'s number — every figure is legitimate, so the
    numeric check alone cannot see it. This looks for any row whose label appears
    in the sentence while none of that row's own figures do, which is the shape of
    that error.
    """
    if not text or not isinstance(result, pd.DataFrame) or len(result) < 2:
        return False
    if len(result) > 12 or len(result.columns) < 2:
        return False

    # Upper bound on how far past a row's label its figures may appear.
    row_window = 110

    lowered = text.lower()
    number_positions = _number_positions(text)
    if not number_positions:
        return False

    # Resolve each row's label to where it appears in the sentence, so a row's
    # figures can be bounded by the next row's label rather than a fixed width.
    mentions = []
    for _, row in result.iterrows():
        label = None
        for value in row.values:
            if _is_missing(value):
                continue
            if isinstance(value, str) and len(value.strip()) >= 2:
                label = value.strip()
                break
        if not label:
            continue
        position = lowered.find(label.lower())
        if position == -1:
            continue
        row_numbers = {
            round(abs(float(value)), 6)
            for value in row.values
            if not _is_missing(value) and isinstance(value, (int, float))
        }
        if row_numbers:
            mentions.append((position, row_numbers))

    if len(mentions) < 2:
        return False

    mentions.sort(key=lambda item: item[0])
    mispaired = 0

    for index, (position, row_numbers) in enumerate(mentions):
        # The clause for this row runs from its label to the next label, capped so
        # a long trailing summary does not absorb unrelated figures.
        end = mentions[index + 1][0] if index + 1 < len(mentions) else len(text)
        end = min(end, position + row_window)
        nearby = [value for value, start in number_positions if position < start <= end]
        if not nearby:
            continue
        if not all(_number_supported(number, row_numbers) for number in nearby):
            mispaired += 1

    return mispaired >= 1


def _number_positions(text):
    """(value, character offset) for every figure in ``text``."""
    values = []
    for match in _NUMBER_IN_TEXT.finditer(text or ''):
        try:
            value = abs(float(match.group(1).replace(',', ''))) * _scale_suffix(match.group(2))
        except ValueError:
            continue
        values.append((value, match.start()))
    return values


def _numbers_in(text):
    return [value for value, _ in _number_positions(text)]


def strip_markdown(text):
    """Reduce a model answer to plain prose.

    Local models will still emit a pipe table or a bulleted list after being told
    not to. The interface renders the real table underneath, so a second markdown
    copy is noise — this removes it and keeps any sentence around it.
    """
    if not text:
        return ''

    def is_tabular(line):
        stripped = line.strip()
        if stripped.startswith('|') or stripped.count('|') >= 2:
            return True
        if stripped and set(stripped) <= set('-|: '):
            return True
        # A fixed-width table pasted from a dataframe: multiple runs of two or
        # more spaces splitting a line into three or more cells.
        cells = re.split(r'\s{2,}', stripped)
        if len(cells) >= 3 and sum(1 for c in cells if c) >= 3:
            return True
        if re.search(r'\S\s{3,}\S', stripped) and len(cells) >= 2:
            # Two columns of numbers/labels, e.g. "Widget          390"
            numeric = sum(1 for c in cells if c and re.fullmatch(r'-?[\d.,]+', c.strip()))
            return numeric >= 1 and len(cells) >= 2 and len(stripped) > 24
        return False

    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if is_tabular(line):
            continue
        if stripped.startswith('#'):
            continue
        # Bulleted / numbered list markers
        line = re.sub(r'^\s{0,3}[-*+]\s+', '', line)
        line = re.sub(r'^\s{0,3}\d+\.\s+', '', line)
        lines.append(line)

    cleaned = '\n'.join(lines)
    # Emphasise/strong markers
    cleaned = re.sub(r'\*\*(.+?)\*\*', r'\1', cleaned)
    cleaned = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'\1', cleaned)
    # Collapse the blank lines left where a table was removed.
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned


def table_payload(result):
    """Render a non-chart dataframe result as a small table for the UI."""
    if isinstance(result, pd.DataFrame):
        frame = result.head(50)
    elif isinstance(result, pd.Series):
        frame = result.head(50).reset_index()
    elif isinstance(result, (list, tuple)) and result and isinstance(result[0], dict):
        frame = pd.DataFrame(result).head(50)
    else:
        return None

    if frame.empty or len(frame.columns) == 0:
        return None

    frame = _normalise_frame(frame)

    # Drop columns that are entirely empty; they carry no information and read as
    # a rendering bug.
    frame = frame.loc[:, ~frame.isna().all()]

    if len(frame.columns) == 0:
        return None

    rows = [
        {key: (None if _is_missing(value) else _json_scalar(value)) for key, value in row.items()}
        for row in frame.to_dict(orient='records')
    ]
    return {'columns': list(frame.columns), 'rows': rows}


def _is_missing(value):
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def result_numbers(result, limit=40):
    """The set of numeric values present in a computed result.

    Used to check a written answer against its own computation: a figure in the
    prose that is not here was invented by the formatting model.
    """
    values = set()

    def add(value):
        if len(values) >= limit:
            return
        try:
            number = float(value)
        except (TypeError, ValueError):
            return
        if number != number or number in (float('inf'), float('-inf')):  # NaN/inf
            return
        values.add(round(abs(number), 6))

    if isinstance(result, pd.DataFrame):
        for row in result.head(50).to_dict(orient='records'):
            for value in row.values():
                add(value)
    elif isinstance(result, pd.Series):
        for value in result.head(50).tolist():
            add(value)
    elif isinstance(result, dict):
        for value in result.values():
            if isinstance(value, (list, tuple)):
                for item in value:
                    add(item)
            else:
                add(value)
    elif isinstance(result, (list, tuple)):
        for item in result:
            add(item)
    else:
        add(result)
    return values


# Matches figures including compact suffixes (5.88k, 2.4m, 1.1bn) so a rendered
# shorthand is compared at its true scale rather than as the digits alone.
_NUMBER_IN_TEXT = re.compile(r'(-?\d[\d,]*(?:\.\d+)?)\s*([kKmMbB]n?)?')


def _scale_suffix(suffix):
    if not suffix:
        return 1
    suffix = suffix.lower()
    if suffix.startswith('k'):
        return 1_000
    if suffix.startswith('b'):
        return 1_000_000_000
    if suffix.startswith('m'):
        return 1_000_000
    return 1


def unsupported_numbers(text, allowed):
    """Numbers mentioned in ``text`` that have no counterpart in ``allowed``.

    Comparison is tolerant: a figure matches if it equals an allowed value, or if
    rounding to the same significant digits does (so 5,880 and 5880.0 and 5.88k
    all agree). Thousands separators are ignored.
    """
    if not text:
        return []

    missing = []
    for match in _NUMBER_IN_TEXT.finditer(text):
        raw, suffix = match.group(1), match.group(2)
        cleaned = raw.replace(',', '')
        try:
            number = abs(float(cleaned)) * _scale_suffix(suffix)
        except ValueError:
            continue

        # Ignore small integers: they are usually counts of rows/sentences, years,
        # or ordinals rather than computed statistics.
        if number < 10 and float(cleaned).is_integer():
            continue

        if _number_supported(number, allowed):
            continue
        missing.append(raw)
    return missing


def _number_supported(number, allowed):
    for candidate in allowed:
        if candidate == 0:
            if number < 1e-9:
                return True
            continue
        # Same value, or same value after normalising scale (2,340 vs 2340.0).
        if abs(number - candidate) <= max(abs(candidate) * 1e-6, 1e-9):
            return True
        # Percentages and ratios: 0.588 vs 58.8.
        ratio = number / candidate if candidate else 0
        if abs(ratio - 100) < 0.5 or abs(ratio - 0.01) < 1e-6:
            return True
    # A rounded form of an allowed value (5,880 -> 5.9k or 6k) still counts.
    for candidate in allowed:
        if round(candidate, -1) == round(number, -1) and abs(candidate - number) <= abs(candidate) * 0.06:
            return True
        if round(candidate) == round(number):
            return True
    return False


def tokenize(text):
    """Split already-computed text into word-sized chunks so replies still stream."""
    return re.findall(r'\s*\S+\s*', text) or ([text] if text else [])
