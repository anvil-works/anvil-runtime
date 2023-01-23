import type { pyObject, pyTuple, pyType } from "./";

declare module "./" {
    export interface pyBaseExceptionConstructor extends pyType<pyBaseException> {
        new (msg?: string): pyBaseException;
    }

    export interface pyBaseException extends pyObject {
        constructor: pyBaseExceptionConstructor;
        readonly ob$type: pyBaseExceptionConstructor;
        args: pyTuple;
        traceback: { filename: string; lineno: string }[];
    }

    export interface pySystemExitConstructor extends pyType<pySystemExit> {
        new (msg?: string): pySystemExit;
    }

    export interface pySystemExit extends pyBaseException {
        constructor: pySystemExitConstructor;
        readonly ob$type: pySystemExitConstructor;
    }
    export interface pyKeyboardInterruptConstructor extends pyType<pyKeyboardInterrupt> {
        new (msg?: string): pyKeyboardInterrupt;
    }

    export interface pyKeyboardInterrupt extends pyBaseException {
        constructor: pyKeyboardInterruptConstructor;
        readonly ob$type: pyKeyboardInterruptConstructor;
    }
    export interface pyGeneratorExitConstructor extends pyType<pyGeneratorExit> {
        new (msg?: string): pyGeneratorExit;
    }

    export interface pyGeneratorExit extends pyBaseException {
        constructor: pyGeneratorExitConstructor;
        readonly ob$type: pyGeneratorExitConstructor;
    }
    export interface pyExceptionConstructor extends pyType<pyException> {
        new (msg?: string): pyException;
    }

    export interface pyException extends pyBaseException {
        constructor: pyExceptionConstructor;
        readonly ob$type: pyExceptionConstructor;
    }
    export interface pyStopIterationConstructor extends pyType<pyStopIteration> {
        new (msg?: string): pyStopIteration;
    }

    export interface pyStopIteration extends pyException {
        constructor: pyStopIterationConstructor;
        readonly ob$type: pyStopIterationConstructor;
    }
    export interface pyStopAsyncIterationConstructor extends pyType<pyStopAsyncIteration> {
        new (msg?: string): pyStopAsyncIteration;
    }

    export interface pyStopAsyncIteration extends pyException {
        constructor: pyStopAsyncIterationConstructor;
        readonly ob$type: pyStopAsyncIterationConstructor;
    }
    export interface pyArithmeticErrorConstructor extends pyType<pyArithmeticError> {
        new (msg?: string): pyArithmeticError;
    }

    export interface pyArithmeticError extends pyException {
        constructor: pyArithmeticErrorConstructor;
        readonly ob$type: pyArithmeticErrorConstructor;
    }
    export interface pyFloatingPointErrorConstructor extends pyType<pyFloatingPointError> {
        new (msg?: string): pyFloatingPointError;
    }

    export interface pyFloatingPointError extends pyArithmeticError {
        constructor: pyFloatingPointErrorConstructor;
        readonly ob$type: pyFloatingPointErrorConstructor;
    }
    export interface pyOverflowErrorConstructor extends pyType<pyOverflowError> {
        new (msg?: string): pyOverflowError;
    }

    export interface pyOverflowError extends pyArithmeticError {
        constructor: pyOverflowErrorConstructor;
        readonly ob$type: pyOverflowErrorConstructor;
    }
    export interface pyZeroDivisionErrorConstructor extends pyType<pyZeroDivisionError> {
        new (msg?: string): pyZeroDivisionError;
    }

    export interface pyZeroDivisionError extends pyArithmeticError {
        constructor: pyZeroDivisionErrorConstructor;
        readonly ob$type: pyZeroDivisionErrorConstructor;
    }
    export interface pyAssertionErrorConstructor extends pyType<pyAssertionError> {
        new (msg?: string): pyAssertionError;
    }

    export interface pyAssertionError extends pyException {
        constructor: pyAssertionErrorConstructor;
        readonly ob$type: pyAssertionErrorConstructor;
    }
    export interface pyAttributeErrorConstructor extends pyType<pyAttributeError> {
        new (msg?: string): pyAttributeError;
    }

    export interface pyAttributeError extends pyException {
        constructor: pyAttributeErrorConstructor;
        readonly ob$type: pyAttributeErrorConstructor;
    }
    export interface pyBufferErrorConstructor extends pyType<pyBufferError> {
        new (msg?: string): pyBufferError;
    }

    export interface pyBufferError extends pyException {
        constructor: pyBufferErrorConstructor;
        readonly ob$type: pyBufferErrorConstructor;
    }
    export interface pyEOFErrorConstructor extends pyType<pyEOFError> {
        new (msg?: string): pyEOFError;
    }

    export interface pyEOFError extends pyException {
        constructor: pyEOFErrorConstructor;
        readonly ob$type: pyEOFErrorConstructor;
    }
    export interface pyImportErrorConstructor extends pyType<pyImportError> {
        new (msg?: string): pyImportError;
    }

    export interface pyImportError extends pyException {
        constructor: pyImportErrorConstructor;
        readonly ob$type: pyImportErrorConstructor;
    }
    export interface pyModuleNotFoundErrorConstructor extends pyType<pyModuleNotFoundError> {
        new (msg?: string): pyModuleNotFoundError;
    }

    export interface pyModuleNotFoundError extends pyImportError {
        constructor: pyModuleNotFoundErrorConstructor;
        readonly ob$type: pyModuleNotFoundErrorConstructor;
    }
    export interface pyLookupErrorConstructor extends pyType<pyLookupError> {
        new (msg?: string): pyLookupError;
    }

    export interface pyLookupError extends pyException {
        constructor: pyLookupErrorConstructor;
        readonly ob$type: pyLookupErrorConstructor;
    }
    export interface pyIndexErrorConstructor extends pyType<pyIndexError> {
        new (msg?: string): pyIndexError;
    }

    export interface pyIndexError extends pyLookupError {
        constructor: pyIndexErrorConstructor;
        readonly ob$type: pyIndexErrorConstructor;
    }
    export interface pyKeyErrorConstructor extends pyType<pyKeyError> {
        new (msg?: string): pyKeyError;
    }

    export interface pyKeyError extends pyLookupError {
        constructor: pyKeyErrorConstructor;
        readonly ob$type: pyKeyErrorConstructor;
    }
    export interface pyMemoryErrorConstructor extends pyType<pyMemoryError> {
        new (msg?: string): pyMemoryError;
    }

    export interface pyMemoryError extends pyException {
        constructor: pyMemoryErrorConstructor;
        readonly ob$type: pyMemoryErrorConstructor;
    }
    export interface pyNameErrorConstructor extends pyType<pyNameError> {
        new (msg?: string): pyNameError;
    }

    export interface pyNameError extends pyException {
        constructor: pyNameErrorConstructor;
        readonly ob$type: pyNameErrorConstructor;
    }
    export interface pyUnboundLocalErrorConstructor extends pyType<pyUnboundLocalError> {
        new (msg?: string): pyUnboundLocalError;
    }

    export interface pyUnboundLocalError extends pyNameError {
        constructor: pyUnboundLocalErrorConstructor;
        readonly ob$type: pyUnboundLocalErrorConstructor;
    }
    export interface pyOSErrorConstructor extends pyType<pyOSError> {
        new (msg?: string): pyOSError;
    }

    export interface pyOSError extends pyException {
        constructor: pyOSErrorConstructor;
        readonly ob$type: pyOSErrorConstructor;
    }
    export interface pyFileNotFoundErrorConstructor extends pyType<pyFileNotFoundError> {
        new (msg?: string): pyFileNotFoundError;
    }

    export interface pyFileNotFoundError extends pyOSError {
        constructor: pyFileNotFoundErrorConstructor;
        readonly ob$type: pyFileNotFoundErrorConstructor;
    }
    export interface pyTimeoutErrorConstructor extends pyType<pyTimeoutError> {
        new (msg?: string): pyTimeoutError;
    }

    export interface pyTimeoutError extends pyOSError {
        constructor: pyTimeoutErrorConstructor;
        readonly ob$type: pyTimeoutErrorConstructor;
    }
    export interface pyReferenceErrorConstructor extends pyType<pyReferenceError> {
        new (msg?: string): pyReferenceError;
    }

    export interface pyReferenceError extends pyException {
        constructor: pyReferenceErrorConstructor;
        readonly ob$type: pyReferenceErrorConstructor;
    }
    export interface pyRuntimeErrorConstructor extends pyType<pyRuntimeError> {
        new (msg?: string): pyRuntimeError;
    }

    export interface pyRuntimeError extends pyException {
        constructor: pyRuntimeErrorConstructor;
        readonly ob$type: pyRuntimeErrorConstructor;
    }
    export interface pyNotImplementedErrorConstructor extends pyType<pyNotImplementedError> {
        new (msg?: string): pyNotImplementedError;
    }

    export interface pyNotImplementedError extends pyRuntimeError {
        constructor: pyNotImplementedErrorConstructor;
        readonly ob$type: pyNotImplementedErrorConstructor;
    }
    export interface pyRecursionErrorConstructor extends pyType<pyRecursionError> {
        new (msg?: string): pyRecursionError;
    }

    export interface pyRecursionError extends pyRuntimeError {
        constructor: pyRecursionErrorConstructor;
        readonly ob$type: pyRecursionErrorConstructor;
    }
    export interface pySyntaxErrorConstructor extends pyType<pySyntaxError> {
        new (msg?: string): pySyntaxError;
    }

    export interface pySyntaxError extends pyException {
        constructor: pySyntaxErrorConstructor;
        readonly ob$type: pySyntaxErrorConstructor;
    }
    export interface pyIndentationErrorConstructor extends pyType<pyIndentationError> {
        new (msg?: string): pyIndentationError;
    }

    export interface pyIndentationError extends pySyntaxError {
        constructor: pyIndentationErrorConstructor;
        readonly ob$type: pyIndentationErrorConstructor;
    }
    export interface pyTabErrorConstructor extends pyType<pyTabError> {
        new (msg?: string): pyTabError;
    }

    export interface pyTabError extends pyIndentationError {
        constructor: pyTabErrorConstructor;
        readonly ob$type: pyTabErrorConstructor;
    }
    export interface pySystemErrorConstructor extends pyType<pySystemError> {
        new (msg?: string): pySystemError;
    }

    export interface pySystemError extends pyException {
        constructor: pySystemErrorConstructor;
        readonly ob$type: pySystemErrorConstructor;
    }
    export interface pyTypeErrorConstructor extends pyType<pyTypeError> {
        new (msg?: string): pyTypeError;
    }

    export interface pyTypeError extends pyException {
        constructor: pyTypeErrorConstructor;
        readonly ob$type: pyTypeErrorConstructor;
    }
    export interface pyValueErrorConstructor extends pyType<pyValueError> {
        new (msg?: string): pyValueError;
    }

    export interface pyValueError extends pyException {
        constructor: pyValueErrorConstructor;
        readonly ob$type: pyValueErrorConstructor;
    }
    export interface pyUnicodeErrorConstructor extends pyType<pyUnicodeError> {
        new (msg?: string): pyUnicodeError;
    }

    export interface pyUnicodeError extends pyValueError {
        constructor: pyUnicodeErrorConstructor;
        readonly ob$type: pyUnicodeErrorConstructor;
    }
    export interface pyUnicodeDecodeErrorConstructor extends pyType<pyUnicodeDecodeError> {
        new (msg?: string): pyUnicodeDecodeError;
    }

    export interface pyUnicodeDecodeError extends pyValueError {
        constructor: pyUnicodeDecodeErrorConstructor;
        readonly ob$type: pyUnicodeDecodeErrorConstructor;
    }
    export interface pyUnicodeEncodeErrorConstructor extends pyType<pyUnicodeEncodeError> {
        new (msg?: string): pyUnicodeEncodeError;
    }

    export interface pyUnicodeEncodeError extends pyValueError {
        constructor: pyUnicodeEncodeErrorConstructor;
        readonly ob$type: pyUnicodeEncodeErrorConstructor;
    }

    export interface pyExternalErrorConstructor extends pyType<pyExternalError> {
        new (nativeError: any): pyExternalError;
    }

    export interface pyExternalError extends pyValueError {
        constructor: pyExternalErrorConstructor;
        readonly ob$type: pyExternalErrorConstructor;
        nativeError: any;
    }
}
