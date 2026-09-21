# prompts spec delta

## ADDED Requirements

### Requirement: Branch review prompts SHALL name the files under review

A branch review SHALL give every agent it runs — the reviewer, the triager and
the fixer — an explicit list of the paths changed on the branch, alongside the
diff itself rather than in place of it.

The prompt SHALL state that every finding must cite one of those paths.
Unchanged code SHALL be described as context the agent may consult in order to
judge a changed line, and never as the subject of a finding in its own right.
The prompt SHALL forbid proposing new files, harnesses, indexes or CI machinery
that none of the changed paths implies.

Where judging a changed line depends on code outside the list, the agent SHALL
cite the changed path and state what it could not verify, rather than either
staying silent or raising a finding against the unchanged file.

Stating the scope is necessary because a patch only implies it: the file list
is scattered across `diff --git` headers interleaved with the content. Agents
holding read-only workspace tools can reach any file in the workspace, so an
implied scope is no longer a practical limit on what they review.

The listed paths SHALL be capped, with any remainder reported as a count, so a
large branch cannot crowd the diff out of the prompt.

#### Scenario: A finding must cite a changed path

- **WHEN** an agent reviews a branch diff
- **THEN** its prompt lists every changed path and requires each finding to
  cite one of them

#### Scenario: Unchanged code is context, not subject matter

- **WHEN** an agent reads an unchanged file through the toolset to judge a
  changed line
- **THEN** it raises its finding against the changed path, not the unchanged one

#### Scenario: A large branch does not crowd out the diff

- **WHEN** a branch changes more paths than the listing cap allows
- **THEN** the prompt lists paths up to the cap and reports the remainder as a
  count

#### Scenario: Every branch-review agent receives the scope

- **WHEN** a branch review runs through review, triage and fix
- **THEN** each of those agents receives the same list of changed paths
