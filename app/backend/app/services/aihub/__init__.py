"""AI Hub service package.

Stub mode: when a stage's ``AIHUB_TOKEN_*`` is unset, the stage runs through a
deterministic local stub and results are stamped ``model_version="stub-1"``.
Real tokens switch to AI Hub with zero code change elsewhere.
"""
