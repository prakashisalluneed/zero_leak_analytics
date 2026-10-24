"""Tests for answer verification and truthful fallbacks.

A local 8B model will occasionally restate a figure it was never given. The
pipeline compares the written answer against the computed result and replaces the
prose when they disagree, so the sentence can never be more confident than the
computation behind it.
"""
import pandas as pd
from django.test import SimpleTestCase

from .analysis import (
    contradicts_table,
    result_numbers,
    strip_markdown,
    unsupported_numbers,
    unwrap_result,
)
from .tasks import _fallback_answer, _format_value


class ResultNumbersTests(SimpleTestCase):
    def test_scalar(self):
        self.assertEqual(result_numbers(5880.0), {5880.0})

    def test_dataframe_collects_every_cell(self):
        df = pd.DataFrame({'region': ['East', 'West'], 'revenue': [134000, 243000]})
        self.assertEqual(result_numbers(df), {134000.0, 243000.0})

    def test_series(self):
        self.assertEqual(result_numbers(pd.Series([10, 20])), {10.0, 20.0})

    def test_ignores_nan(self):
        df = pd.DataFrame({'a': [1.0, float('nan')]})
        self.assertEqual(result_numbers(df), {1.0})


class UnsupportedNumbersTests(SimpleTestCase):
    allowed = {5880.0}

    def test_accepts_exact_figure(self):
        self.assertEqual(unsupported_numbers('Gadget earned 5,880.', self.allowed), [])

    def test_accepts_compact_form(self):
        self.assertEqual(unsupported_numbers('Gadget earned 5.88k.', self.allowed), [])

    def test_accepts_trailing_zeros(self):
        self.assertEqual(unsupported_numbers('Total: 5880.0', self.allowed), [])

    def test_flags_the_real_hallucination(self):
        text = (
            'The product that generated the most revenue is Gadget, with a revenue of '
            'approximately 1,500 units times $10 per unit, resulting in $15,000.'
        )
        self.assertEqual(unsupported_numbers(text, self.allowed), ['1,500', '10', '15,000'])

    def test_ignores_small_counts(self):
        # "3 of 4 rows" is narrative, not a statistic.
        self.assertEqual(unsupported_numbers('3 of the 4 rows matched.', self.allowed), [])

    def test_flags_derived_ratio(self):
        self.assertEqual(unsupported_numbers('5,880, about 2.4 times more.', self.allowed), ['2.4'])

    def test_empty_text_is_fine(self):
        self.assertEqual(unsupported_numbers('', self.allowed), [])


class FallbackAnswerTests(SimpleTestCase):
    def test_single_row_table_states_the_computed_values(self):
        df = pd.DataFrame([{'product': 'Gadget', 'revenue': 5880.0}])
        answer = _fallback_answer(df)
        self.assertIn('Gadget', answer)
        self.assertIn('5,880', answer)
        # It must not invent anything beyond the computation.
        self.assertEqual(unsupported_numbers(answer, result_numbers(df)), [])

    def test_large_table_describes_the_shape(self):
        df = pd.DataFrame({'a': range(20), 'b': range(20)})
        answer = _fallback_answer(df)
        self.assertIn('20 rows', answer)
        self.assertEqual(unsupported_numbers(answer, result_numbers(df)), [])

    def test_empty_frame(self):
        self.assertIn('no matching rows', _fallback_answer(pd.DataFrame()))

    def test_scalar(self):
        self.assertIn('5,880', _fallback_answer(5880.0))

    def test_list(self):
        self.assertIn('1, 2, 3', _fallback_answer([1, 2, 3]))

    def test_numpy_record_renders_its_fields(self):
        # What `frame[['product','price']].values[0]` produces: a 1-D object array.
        import numpy as np

        answer = _fallback_answer(np.array(['Gadget', 42.0], dtype=object))
        self.assertEqual(answer, 'The computed result is Gadget: 42.')
        self.assertNotIn('[', answer)
        self.assertNotIn("'", answer)

    def test_nested_single_record(self):
        answer = _fallback_answer([['Gadget', 42.0]])
        self.assertIn('Gadget', answer)
        self.assertNotIn("'", answer)

    def test_dict(self):
        answer = _fallback_answer({'revenue': 5880.0})
        self.assertIn('5,880', answer)


class ContradictsTableTests(SimpleTestCase):
    """Detects a row's label being described with a different row's figures."""

    def setUp(self):
        self.frame = pd.DataFrame(
            {
                'product': ['Widget', 'Gadget', 'Doohickey'],
                'total_units': [270, 140, 390],
                'total_revenue': [5265.0, 5880.0, 2827.5],
            }
        )

    def test_flags_mispaired_rows(self):
        text = (
            'Widget has 390 units and $2827.50 in revenue, Gadget has 140 units and '
            '$5880.00, and Doohickey has 270 units and $5265.00.'
        )
        self.assertTrue(contradicts_table(text, self.frame))

    def test_accepts_correct_single_row(self):
        self.assertFalse(contradicts_table('Widget led with 270 units.', self.frame))

    def test_accepts_summary_without_enumerating(self):
        text = 'The table shows totals per product; Gadget had the highest revenue at 5,880.'
        self.assertFalse(contradicts_table(text, self.frame))

    def test_accepts_consistent_enumeration(self):
        text = (
            'Widget has 270 units, Gadget has 140 units with 5,880 in revenue, and '
            'Doohickey has 390 units.'
        )
        self.assertFalse(contradicts_table(text, self.frame))

    def test_flags_whole_rows_swapped(self):
        # Every figure is a real value from the table, but attached to the wrong
        # label — the numeric check alone cannot see this.
        frame = pd.DataFrame(
            {
                'product': ['Widget', 'Gadget', 'Doohickey'],
                'units': [390, 140, 270],
                'revenue': [2827.5, 5880.0, 5265.0],
            }
        )
        text = (
            'Widget has 270 units and 5265.0 in revenue, Gadget has 140 units, and '
            'Doohickey has 390 units.'
        )
        self.assertTrue(contradicts_table(text, frame))

    def test_ignores_non_frames(self):
        self.assertFalse(contradicts_table('Widget 270', pd.Series([1, 2])))

    def test_single_row_frame_is_not_checked(self):
        one = self.frame.head(1)
        self.assertFalse(contradicts_table('Widget had 390 units.', one))


class StripMarkdownTests(SimpleTestCase):
    def test_removes_pipe_table(self):
        text = (
            'Here is the table:\n\n'
            '| product | units |\n'
            '|---------|-------|\n'
            '| Widget  | 270   |\n'
            '| Gadget  | 140   |\n'
        )
        cleaned = strip_markdown(text)
        self.assertNotIn('|', cleaned)
        self.assertIn('Here is the table', cleaned)

    def test_removes_list_markers(self):
        self.assertEqual(strip_markdown('- first\n- second'), 'first\nsecond')

    def test_removes_fixed_width_table(self):
        text = (
            'Totals per product:\n'
            '  product  total_units  total_revenue\n'
            '   Widget          390         2827.5\n'
            '   Gadget          140         5880.0\n'
        )
        cleaned = strip_markdown(text)
        self.assertIn('Totals per product', cleaned)
        self.assertNotIn('Widget', cleaned)
        self.assertNotIn('2827.5', cleaned)

    def test_keeps_normal_sentences_with_numbers(self):
        text = 'Widget led with 270 units and 5,265 in revenue.'
        self.assertEqual(strip_markdown(text), text)

    def test_removes_bold(self):
        self.assertEqual(strip_markdown('Revenue was **5,880** today.'), 'Revenue was 5,880 today.')

    def test_keeps_plain_prose(self):
        text = 'Gadget led with 5,880 in revenue.'
        self.assertEqual(strip_markdown(text), text)

    def test_handles_empty(self):
        self.assertEqual(strip_markdown(''), '')


class UnwrapResultTests(SimpleTestCase):
    def test_value_and_method(self):
        value, method = unwrap_result({'value': 5880.0, 'method': 'revenue = units * price'})
        self.assertEqual(value, 5880.0)
        self.assertEqual(method, 'revenue = units * price')

    def test_value_only(self):
        self.assertEqual(unwrap_result({'value': 42}), (42, ''))

    def test_plain_value_passes_through(self):
        self.assertEqual(unwrap_result(5880.0), (5880.0, ''))

    def test_chart_dict_is_not_unwrapped(self):
        chart = {'chart_type': 'bar', 'chart_data': [{'a': 1}]}
        self.assertEqual(unwrap_result(chart), (chart, ''))


class FormatValueTests(SimpleTestCase):
    def test_integers_get_separators(self):
        self.assertEqual(_format_value(5880), '5,880')

    def test_integral_floats_lose_the_point(self):
        self.assertEqual(_format_value(5880.0), '5,880')

    def test_fractional_floats_keep_two_places(self):
        self.assertEqual(_format_value(2827.5), '2,827.50')

    def test_booleans_read_as_words(self):
        self.assertEqual(_format_value(True), 'yes')

    def test_nan_is_described(self):
        self.assertEqual(_format_value(float('nan')), 'not available')
