"""Unit tests for WrappedList.
"""
import unittest
from copy import deepcopy

from anvil import util

class Test___init__(unittest.TestCase):
    """Tests for .__init__() method.
    """
    def test_lookup(self):
        """When I instantiate a WrappedList from a list, I can
        get items from it just like a list.

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I get the item at index <j> from the WrappedList
        Then the value is identical to the item at index <j> in the list

        Examples:
          | A     | j |
          | 10000 | 5 |
        """
        # -- Given
        A = 10000
        L = list(range(A))
        if len(L) != A:
            raise RuntimeError("Test problem: length must be equal to A.")
        WL = util.WrappedList(L)

        # -- When
        j = 5
        result = WL[5]

        # -- Then
        self.assertEqual(result, L[j])
        assert result is L[j]


if __name__ == '__main__':
    unittest.main()