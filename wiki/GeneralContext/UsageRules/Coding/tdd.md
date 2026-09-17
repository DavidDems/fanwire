# TDD

## MUST NOT
- Write implementation code before a failing test exists for that exact change, written against the intended interface even if the entity doesn't exist yet.
- Commit the failing test and the implementation together. Two commits, always: test alone, then implementation.
- Skip the failing-test step for a change judged "too small to need a test" — there is no size exception.
- Mark a task done while the test that defines its contract is missing, skipped, or commented out.
- Treat passing the test as optional once written — implement until it passes, not until it's "close enough."
