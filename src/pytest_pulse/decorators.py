from contextlib import contextmanager
import functools
from typing import Any, Callable, TypeVar, cast, Generator
from .plugin import pulse_step_context

F = TypeVar("F", bound=Callable[..., Any])

@contextmanager
def pulse_step(title: str) -> Generator[None, None, None]:
    """Context manager to record a test step.
    
    Can be imported directly: ``from pytest_pulse import pulse_step``
    """
    recorder_step = pulse_step_context.get()
    if recorder_step:
        with recorder_step(title):
            yield
    else:
        yield

def step(title: str) -> Callable[[F], F]:
    """Decorator to automatically wrap a function or method in a Pulse step.
    
    Usage::

        @step("Login to application")
        def login(username, password):
            ...
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Retrieve the step recorder from the ContextVar set by the pulse_step fixture
            pulse_step = pulse_step_context.get()
            if pulse_step:
                with pulse_step(title):
                    return func(*args, **kwargs)
            else:
                # Fallback: if no active pulse session, just run the function
                return func(*args, **kwargs)
        return cast(F, wrapper)
    return decorator
