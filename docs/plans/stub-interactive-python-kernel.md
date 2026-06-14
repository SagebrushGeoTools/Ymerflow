# Interactive python kernel

**GitHub Issue:** #4
**State:** open
**Labels:** enhancement, frontend, backend, pipeline

## Description

_Migrated from deprecated-nagelfluh #4 (originally by @redhog)_

A process that while it runs, gives the user an interactive python prompt with the standard fsspec api to read and write data. Output datasets would be possible to plot once the user exits, but not use as input for other processes. The commandline history would be preserved as the process log. Potentially: Preserve user input separately, allowing the rerunning and producing the same output, in which case outputs could be allowed to use as inputs in other processes.
