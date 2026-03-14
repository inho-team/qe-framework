---
name: Qhelp
description: "Shows QE Framework usage overview in terminal. Use for 'help', 'how to use', 'show commands', 'what can you do'."
---
> Shared principles: see core/PRINCIPLES.md

# Qhelp — QE Framework Quick Reference

## Role
Displays a concise overview of all available skills and agents in the terminal.

## Execution Procedure

Print the following reference card directly to the user (do not use any tools):

```
QE Framework (Query Executor) — Quick Reference
================================================

WORKFLOW
  /Qgenerate-spec          Create task spec documents
  /Qrun-task [UUID]        Execute tasks with verification
  /Qcommit                 Commit & push (human-style, no AI traces)
  /Qupdate                 Update plugin to latest version
  /Qutopia [on|off]        Toggle fully autonomous mode

DEVELOPMENT
  /Qsystematic-debugging   Root cause analysis before fixing
  /Qtest-driven-development TDD: red-green-refactor cycle
  /Qcode-run-task          Quality loop: test → review → fix
  /Qfrontend-design        Production-grade UI components
  /Qspringboot-security    Spring Security best practices
  /Qdatabase-schema-designer Database schema design
  /Qdoc-comment            Add doc comments (JSDoc, PyDoc, etc.)
  /Qmcp-builder            Build MCP servers
  /Qagent-browser          Browser automation

TASK MANAGEMENT
  /Qinit                   Initialize QE in a project
  /Qrefresh                Refresh project analysis
  /Qresume                 Restore previous session context
  /Qcompact                Save context / session handoff
  /Qarchive                Archive completed tasks
  /Qmigrate-tasks          Migrate task files to .qe/

DOCUMENTATION
  /Qdocx                   Word documents
  /Qpdf                    PDF operations
  /Qpptx                   Presentations
  /Qxlsx                   Spreadsheets
  /Qwriting-clearly        Improve prose quality
  /Qhumanizer              Remove AI writing traces
  /Qprofessional-communication  Professional emails & messages
  /Qmermaid-diagrams       Mermaid diagrams
  /Qc4-architecture        C4 architecture diagrams
  /Qimage-analyzer         Image & screenshot analysis

ACADEMIC
  /Qgrad-paper-write       Draft academic papers
  /Qgrad-paper-review      Respond to reviewer comments
  /Qgrad-research-plan     Literature review & experiment design
  /Qgrad-seminar-prep      Prepare presentations
  /Qgrad-thesis-manage     Thesis progress management

PLANNING
  /Qpm-prd                 Write PRDs
  /Qpm-user-story          User stories with Gherkin criteria
  /Qpm-roadmap             Strategic roadmaps
  /Qrequirements-clarity   Clarify ambiguous requirements
  /Qqa-test-planner        QA test plans & bug reports

MEDIA
  /Qaudio-transcriber      Audio → text (meeting notes)
  /Qyoutube-transcript-api YouTube subtitles & transcription
  /Qtranslate              Multilingual translation

META
  /Qskill-creator          Create or modify skills
  /Qcommand-creator        Create slash commands
  /Qfind-skills            Search skills.sh marketplace
  /Qalias                  Path & command aliases
  /Qprofile                Analyze usage patterns
  /Qagent-md-refactor      Refactor instruction files
  /Qweb-design-guidelines  UI/UX review
  /Qlesson-learned         Extract engineering lessons
  /Qhelp                   This help screen

AGENTS (auto-selected by complexity)
  HIGH   Edeep-researcher, Eqa-orchestrator
  MEDIUM Etask-executor, Ecode-debugger, Ecode-reviewer,
         Ecode-test-engineer, Ecode-doc-writer, Edoc-generator,
         Egrad-writer, Epm-planner, Erefresh-executor,
         Ecompact-executor, Ehandoff-executor
  LOW    Earchive-executor, Ecommit-executor, Eprofile-collector
```

## Will
- Display the quick reference card

## Will Not
- Execute any commands
- Modify any files
