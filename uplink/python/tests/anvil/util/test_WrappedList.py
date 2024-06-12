"""Unit tests for WrappedList.
"""
import unittest
from copy import deepcopy
from copy import copy as shallow

from anvil import util

_SHALLOW_SERIALIZABLE_CLASSES: tuple = (list, )
"""These classes are deemed shallow serializable.

That means that each of these classes, is itself natively serializable,
provided that each of the elements are natively serializable.
"""

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
        actual.append(item)

        # -- Then
        self.assertEqual(len(actual), A+1)
        # Expect that each of the first <A> elements is the same as before the operation
        for j in range(A):
            self.assertEqual(actual[j], expected[j])
            assert actual[j] is expected[j]

        # Expect that the last element is equal to the wrapped item
        self.assertEqual(actual[-1], util._wrap(item))

class Test_extend(unittest.TestCase):
    """Tests for .extend() method.
    """
    def test_0(self):
        """When I extend a WrappedList with 0 items, this is a no-op

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I extend the WrappedList with 0 items
        Then the WrappedList contains <A> elements
        And each element is the same as before the operation

        Examples:
          | A     |
          | 10000 |
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
        actual.extend([])

        # -- Then
        self.assertEqual(len(actual), A)
        for j in range(A):
            self.assertEqual(actual[j], expected[j])
            assert actual[j] is expected[j]
    def test_1(self):
        """When I extend a WrappedList with 1 item, it is added to the end

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I extend the WrappedList with 1 item
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
        items = [A]
        actual.extend(items)

        # -- Then
        self.assertEqual(len(actual), A+1)
        # Expect that each of the first <A> elements is the same as before the operation
        for j in range(A):
            self.assertEqual(actual[j], expected[j])
            assert actual[j] is expected[j]

        # Expect that the last element is equal to the wrapped item
        self.assertEqual(actual[-1], util._wrap(items[-1]))
    def test_N(self):
        """When I extend a WrappedList with 1 item, it is added to the end

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I extend the WrappedList with <N> items
        Then the WrappedList contains <A>+<N> elements
        And each of the first <A> elements is the same as before the operation
        And the mth from the last <N> elements is equal to the mth wrapped item

        Examples:
          | A     | N     |
          | 10000 | 500   |

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
        N = 500
        items = [item for item in range(A, A+N)]
        if len(items) != N:
            raise RuntimeError("Test problem: length of new items must be equal to N")
        actual.extend(items)

        # -- Then
        self.assertEqual(len(actual), A+N)
        # Expect that each of the first <N> elements is the same as before the operation
        for j in range(A):
            self.assertEqual(actual[j], expected[j])
            assert actual[j] is expected[j]

        # Expect that the mth from the last <N> elements is equal to the mth wrapped item
        for m in range(N):
            self.assertEqual(actual[A+m], util._wrap(items[m]))

class Test_insert(unittest.TestCase):
    """Tests for .insert() method.
    """
    def test_1(self):
        """When I insert 1 item into a WrappedList, it is added at the specified position

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I insert 1 item into the WrappedList at position <P>
        Then the WrappedList contains <A>+1 elements
        And each of the first <P> elements is the same as before the operation
        And the <P>th element is equal to the wrapped item
        And the last <A>-<P> elements are the same as after the operation

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
        P = 3
        actual.insert(P, item)

        # -- Then
        self.assertEqual(len(actual), A+1)
        # Expect that each of the first <P> elements is the same as before the operation
        for j in range(P):
            self.assertEqual(actual[j], expected[j])
            assert actual[j] is expected[j]

        # Expect that the <P>th element is equal to the wrapped item
        self.assertEqual(actual[P], util._wrap(item))
        
        # Expect that each of the last <P> elements is the same as before the operation
        for j in range(A-P):
            self.assertEqual(actual[-j], expected[-j])
            assert actual[-j] is expected[-j]

class Test___serialize__(unittest.TestCase):
    """Tests for .__serialize__() method.
    """
    def test_list(self):
        """When I serialize a WrappedList, I get the data back in list form.

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I serialize the WrappedList
        And I provide some global data
        Then I get a shallow serializable result back
        And each of the elements is equal to the value in the WrappedList

        Examples:
          | A     |
          | 10000 |
        """
        # -- Given
        A = 10000
        L = list(range(A))
        if len(L) != A:
            raise RuntimeError("Test problem: length must be equal to A")
        WL = util.WrappedList(L)

        # -- When
        global_data = None
        result = WL.__serialize__(global_data)

        # -- Then
        # Expect that I get a shallow serializable result back
        assert isinstance(result, _SHALLOW_SERIALIZABLE_CLASSES)

        # Expect that each of the elements is equal to the value in the WrappedList
        for j in range(A):
            self.assertEqual(result[j], WL[j])

class Test___deserialize__(unittest.TestCase):
    """Tests for .__deserialize__() method.
    """
    def test_shallowInsert_list(self):
        """When I deserialize a list into a WrappedList, I shallow insert into the WrappedList

        Given that I have a list with <A> elements
        And I instantiate a WrappedList
        When I deserialize the list into the WrappedList
        And I provide some global data
        Then each of the elements in the WrappedList is equal to the value in the list

        Examples:
          | A     |
          | 10000 |
        """
        # -- Given
        A = 10000
        L = list(range(A))
        if len(L) != A:
            raise RuntimeError("Test problem: length must be equal to A")
        # Instantiate without initialization
        WL = util.WrappedList.__new__(util.WrappedList)

        # -- When
        global_data = None
        WL.__deserialize__(L, global_data)

        # -- Then
        # Expect that each of the elements in the WrappedList is equal to the value in the list
        for j in range(A):
            self.assertEqual(WL[j], L[j])

class Test___copy__(unittest.TestCase):
    """Tests for .__copy__() method.
    """
    def test_shallow(self):
        """When I copy a WrappedList, I get a shallow copy.

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I copy the WrappedList
        Then I get back a shallow copy of the WrappedList

        Examples:
          | A     |
          | 10000 |
        """
        # -- Given
        A = 10000
        L = list(range(A))
        if len(L) != A:
            raise RuntimeError("Test problem: length must be equal to A")
        WL = util.WrappedList(L)

        # -- When
        result = shallow(WL)

        # -- Then
        assert result is not WL
        for j in range(A):
            self.assertEqual(result[j], shallow(WL[j]))
            assert result[j] is WL[j]

class Test___deepcopy__(unittest.TestCase):
    """Tests for .__deepcopy__() method.
    """
    def test_shallow(self):
        """When I copy a WrappedList, I get a deep copy.

        Given that I have a list with <A> elements
        And that I construct a WrappedList from the list
        When I deep copy the WrappedList
        Then I get back a deep copy of the WrappedList

        Examples:
          | A     |
          | 10000 |
        """
        # -- Given
        A = 10000
        L = list(range(A))
        if len(L) != A:
            raise RuntimeError("Test problem: length must be equal to A")
        WL = util.WrappedList(L)

        # -- When
        result = deepcopy(WL)

        # -- Then
        assert result is not WL
        for j in range(A):
            self.assertEqual(result[j], deepcopy(WL[j]))

            # NOTE: deepcopy is not guaranteed to return non-identical for some instances,
            #       such as int with value <=255 (each of which are singletons
            #       in some Python implementations).
            #       
            #       Therefore, instead, do not perform identity check
            pass

if __name__ == '__main__':
    unittest.main()