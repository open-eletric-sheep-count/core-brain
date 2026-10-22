# OpenCode and Codex installer plan

1. Inspect the existing OpenCode suite and the working Codex adaptation. Research
   current official plugin, skill, MCP and hook contracts before implementation.
2. Define executable scenarios for fresh installs, existing configuration,
   dry-run, repeat installation, invalid input, legacy entry points and paths
   containing spaces. Run them before implementing the shared installer.
3. Add the Codex source tree and a shared host-selecting installer. Preserve the
   original engine and learning algorithm. Merge host configuration, back up
   changed files and keep model/runtime provisioning explicit.
4. Put installation guidance at the repository root, retain a forwarding link
   from the former plugin-specific guide and add a reusable agent prompt to the
   README, including the boundaries for adapting other CLIs.
5. Run both installations in disposable directories, the original relevant
   checks, and a fresh actual Codex process with the installed MCP. Report
   runtime/hook paths actually exercised and any remaining native trust action.

The working tree was clean before this task. No commit or publication is part
of the request. Public OpenCode defaults remain generic; Taulukko personal
overrides and production memory records are not distributed.
