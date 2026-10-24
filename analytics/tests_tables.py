"""Tests for shaping computed results into tables the UI can render."""
import pandas as pd
from django.test import SimpleTestCase

from .analysis import table_payload


class TablePayloadTests(SimpleTestCase):
    def test_named_frame_passes_through(self):
        frame = pd.DataFrame({'product': ['A', 'B'], 'revenue': [1.0, 2.0]})
        payload = table_payload(frame)
        self.assertEqual(payload['columns'], ['product', 'revenue'])
        self.assertEqual(payload['rows'][1], {'product': 'B', 'revenue': 2.0})

    def test_unnamed_series_gets_a_readable_column(self):
        # df.groupby('product').apply(...) yields an unnamed Series; reset_index
        # would otherwise name the value column "0".
        frame = pd.DataFrame({'product': ['A', 'B'], 'units': [2, 3], 'price': [1.5, 2.0]})
        series = frame.groupby('product').apply(
            lambda d: (d.units * d.price).sum(), include_groups=False
        )
        payload = table_payload(series)
        self.assertEqual(payload['columns'], ['product', 'value'])
        self.assertEqual(payload['rows'][0], {'product': 'A', 'value': 3.0})

    def test_multiindex_groupby_labels_are_readable(self):
        frame = pd.DataFrame(
            {'product': ['A', 'A', 'B'], 'month': ['Jan', 'Feb', 'Jan'], 'units': [1, 2, 3]}
        )
        series = frame.groupby(['product', 'month'])['units'].sum()
        payload = table_payload(series)
        self.assertEqual(payload['columns'], ['product', 'month', 'units'])
        self.assertNotIn('(', payload['columns'][0])

    def test_entirely_empty_columns_are_dropped(self):
        # This is the shape that produced a null-filled "0" column in the UI.
        frame = pd.DataFrame({'product': ['A', 'B'], 0: [None, None]})
        payload = table_payload(frame)
        self.assertEqual(payload['columns'], ['product'])

    def test_empty_frame_returns_none(self):
        self.assertIsNone(table_payload(pd.DataFrame()))

    def test_scalar_returns_none(self):
        self.assertIsNone(table_payload(42))

    def test_list_of_dicts(self):
        payload = table_payload([{'a': 1}, {'a': 2}])
        self.assertEqual(payload['columns'], ['a'])
        self.assertEqual(len(payload['rows']), 2)

    def test_rows_are_capped(self):
        frame = pd.DataFrame({'n': range(200)})
        payload = table_payload(frame)
        self.assertEqual(len(payload['rows']), 50)

    def test_datetime_columns_render_as_text(self):
        frame = pd.DataFrame({'when': pd.to_datetime(['2026-01-01']), 'n': [1]})
        payload = table_payload(frame)
        self.assertIsInstance(payload['rows'][0]['when'], str)

    def test_nulls_become_none(self):
        frame = pd.DataFrame({'a': [1.0, None], 'b': ['x', 'y']})
        payload = table_payload(frame)
        self.assertIsNone(payload['rows'][1]['a'])
