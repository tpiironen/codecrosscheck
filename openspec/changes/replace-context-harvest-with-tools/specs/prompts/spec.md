# prompts spec delta

## MODIFIED Requirements

### Requirement: Grounding rules SHALL be reduced to what tools do not guarantee

The fixer prompt SHALL be reduced to the grounding rules that tool access does
not already provide: that an identifier must exist in source the worker has
actually read, and that a change assumed from an earlier round must be included
in the current one.

`review_branch_fixer.md` currently devotes its longest rule to forbidding the
model from referencing identifiers it was not handed, because pre-injection
could not guarantee the model had the relevant source. Once the worker can read
the workspace on demand, that reasoning no longer holds.

The instruction not to respond with "Data I need" placeholders SHALL be
removed, because the condition it describes can no longer arise.

#### Scenario: Fixer is told to read rather than told not to invent

- **WHEN** the fixer prompt is loaded
- **THEN** it directs the worker to read the source it needs through the
  toolset, and does not enumerate placeholder phrases to avoid

#### Scenario: Self-contained-round rule is retained

- **WHEN** the fixer prompt is loaded
- **THEN** it still requires each round to be a complete, self-contained
  proposal
