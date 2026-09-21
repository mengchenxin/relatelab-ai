# Architecture

## Goal

RelateLab converts unstructured relationship conversations into a traceable, evaluable case without presenting the model as a companion or therapist.

## Runtime flow

1. The API validates the case with a shared Zod contract.
2. The redaction layer removes common identifiers from text.
3. A state-machine orchestrator executes ingestion, timeline extraction, dynamics analysis, safety triage, and strategy generation.
4. Each agent emits structured output. Invalid model output is retried once and then falls back to the deterministic analyzer in mock mode.
5. The run is persisted with the result, trace, usage metrics, provider, model, warnings, and duration.
6. The evaluation runner executes a versioned dataset and scores schema validity, safety matching, evidence coverage, strategy diversity, and redaction.

## Production evolution

The local implementation uses SQLite and deterministic retrieval so it can run without infrastructure. The interfaces are kept behind small modules so they can be replaced:

- SQLite -> PostgreSQL
- in-process retrieval -> pgvector or a dedicated vector database
- synchronous orchestration -> Redis-backed queue and workers
- local trace rows -> OpenTelemetry and Langfuse
- single API process -> horizontally scaled API and worker processes

## Safety boundaries

The system may analyze communication patterns, but it does not diagnose mental health conditions, determine whether abuse occurred with certainty, or replace emergency services. High-risk language triggers a safety-first branch that prioritizes immediate help and avoids ordinary relationship persuasion strategies.
