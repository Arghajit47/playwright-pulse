from contextlib import contextmanager
import functools
import inspect
from typing import Any, Callable, TypeVar, cast, Generator
from .plugin import pulse_step_context
from .shared_ui import console, error_console

F = TypeVar("F", bound=Callable[..., Any])

@contextmanager
def pulse_step(title: str) -> Generator[None, None, None]:
    """Context manager to record a test step.
    
    Can be imported directly: ``from pytest_pulse import pulse_step``
    """
    recorder_step = pulse_step_context.get()
    if recorder_step:
        # We must re-set the context inside the block to ensure 
        # that nested calls (even deep in POMs) find the right parent.
        with recorder_step(title):
            yield
    else:
        yield

def step(title: str) -> Callable[[F], F]:
    """Decorator to automatically wrap a function or method in a Pulse step.
    
    Supports both regular functions and generator functions (yielding fixtures).
    """
    def decorator(func: F) -> F:
        if inspect.isgeneratorfunction(func):
            @functools.wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                recorder_step = pulse_step_context.get()
                if recorder_step:
                    with recorder_step(title):
                        yield from func(*args, **kwargs)
                else:
                    yield from func(*args, **kwargs)
        else:
            @functools.wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                recorder_step = pulse_step_context.get()
                if recorder_step:
                    with recorder_step(title):
                        return func(*args, **kwargs)
                else:
                    return func(*args, **kwargs)
        return cast(F, wrapper)
    return decorator
