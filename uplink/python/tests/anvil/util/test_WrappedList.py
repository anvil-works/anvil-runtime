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

class Test_append(unittest.TestCase):
    """Tests for .append() method.
    """
    def test_1(self):
        """When I append 1 item to a WrappedList, it is added to the end

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I append 1 item to the WrappedList
        Then the WrappedList contains <A>+1 elements
        And each of the first <A> elements is the same as before the operation
        And the last element is equal to the wrapped item

        Examples:
          | A     |
          | 10000 |

        Notes
        -----
        A wrapped item is equal to util._wrap(item).
        """
        # -- Given
        A = 10000
        L = list(range(A))
        if len(L) != A:
            raise RuntimeError("Test problem: length must be equal to A")
        actual = util.WrappedList(L)

        # Store a copy
        expected = util.WrappedList(deepcopy(L))

        # -- When
        item = A+1
        actual.append(A+1)

        # -- Then
        self.assertEqual(len(actual), A+1)
        # Expect that each of the first <A> elements is the same as before the operation
        for j in range(A):
            self.assertEqual(actual[j], expected[j])
            assert actual[j] is expected[j]

        # Expect that the last element is equal to the wrapped item
        self.assertEqual(actual[-1], util._wrap(item))


if __name__ == '__main__':
    unittest.main()