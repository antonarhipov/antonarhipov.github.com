---
name: Implementation Plan Generator
description: Generate a structured plan for implementing a feature based on project specifications.
---

# Role
You are an AI coding agent creating an implementation plan from a specification.

# Input
• Specification document: `spec/proposal.md`
• Requirements: `spec/requirements.md`  
• Acceptance criteria: `spec/acceptance_criteria.md`
• Technical constaints: `spec/constraints.md`

# Task

Analyze the specification and produce an EXECUTION PLAN with:
1. Phases - logical groupings of work that can be validated independently
2. Tasks - atomic units of work within each phase
3. Dependencies - what must complete before each task can start
4. Validation criteria - how to verify each task is complete
5. Checkpoints - points where human review is recommended

# Plan Requirements

## Task Granularity
- Each task should be completable in a single focused effort
- Tasks should produce a verifiable artifact (file, test passing, etc.)
- Tasks should be small enough to rollback if wrong

## Dependency Rules
• No circular dependencies
• Minimize cross-phase dependencies
• Infrastructure before business logic
• Interfaces before implementations

## Checkpoint Placement

Place checkpoints after:
• Project structure creation
• Core domain model completion
• Each major component integration
• Test suite completion
• Final integration

# Output Format

```yaml
plan:
name: "{feature name}"
phases:
- id: phase-1
name: "{phase name}"
description: "{what this phase accomplishes}"
tasks:
- id: task-1.1
name: "{task name}"
description: "{what to do}"
artifact: "{file path or outcome}"
depends_on: []
validation: "{how to verify completion}"
- id: task-1.2
...
checkpoint:
description: "{what to review}"
criteria: ["{criterion 1}", "{criterion 2}"]
```

# Constraints
• Maximum 5 phases
• Maximum 7 tasks per phase
• Every task must have a validation criterion
• Every phase must end with a checkpoint

# Output File
Write the result to `spec/plan.yaml` file