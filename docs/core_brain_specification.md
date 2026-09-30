# core-brain — Specification & Architecture

## Overview

**core-brain** is a fork of the PLUR Memory project designed to provide multi-agent instance isolation, customizable access controls, and vector memory management.

* **License:** MIT License
* **Original Project Acknowledgment:** Built upon and inspired by the original PLUR Memory project (`http://linkhere.github.com`).

## 1. Objective

Enable `core-brain` to handle multiple agent instances with distinct vector database namespaces instead of storing all memories in a single monolithic database. Instance parameters are dynamically loaded from a `config.json` file to manage isolation and global memory access.

## 2. Configuration Schema (`config.json`)

Add an `agents` array to `config.json`:

```json
{
  "agents": [
    {
      "name": "agent_alpha",
      "hasGlobalAccess": true,
      "private": false
    },
    {
      "name": "agent_beta",
      "hasGlobalAccess": true,
      "private": true
    }
  ]
}
```

### Configuration Rules & Validation Constraints

* **`name`** (`string`, required): Unique identifier for the agent instance. Maps directly to its isolated database namespace.
* **`hasGlobalAccess`** (`boolean`, required): Controls access to the shared global database (`global_db`).
* **`private`** (`boolean`, required): Controls whether this agent's isolated database (`agent_db`) can be queried by other agents.
* **Validation Error (`InvalidConfigurationError`):**
  Setting both **`private: false`** and **`hasGlobalAccess: false`** is invalid and **must throw a initialization error**. If an agent is not private (intended to contribute to shared knowledge) but is denied global database access, it cannot write to or read from the shared layer, creating an illogical configuration state.

## 3. Storage Architecture

* **Global Database:** A shared `global` storage namespace (`db/global/` or collection `memories_global`).
* **Agent Databases:** Dynamically created isolated vector stores per agent based on `name` (e.g., `db/{agent_name}/` or collection `memories_{agent_name}`).

## 4. Access & Retrieval Matrix

When an agent requests a memory query or retrieval:

| `private` | `hasGlobalAccess` | Status | Datasets Queried by Agent | Readable by Other Agents? |
| :---: | :---: | :---: | :--- | :---: |
| `false` | `true` | **Valid** | `agent_db` + `global_db` | Yes (Public Agent Space) |
| `false` | `false` | **Invalid** | **Throws Error (Invalid Config)** | N/A |
| `true` | `true` | **Valid** | `agent_db` + `global_db` | **No** (Private to this Agent) |
| `true` | `false` | **Valid** | `agent_db` only | **No** (Private to this Agent) |

## 5. Implementation Roadmap

1. **Config Loader & Validation:** Parse `config.json` on startup and throw an explicit configuration error if `private: false` and `hasGlobalAccess: false` are configured together.
2. **Database Router:** Implement `getInstance(agentName)` handler to dynamically connect to the appropriate local/global database instances.
3. **Write Path:** Direct memory writes to `memories_{agent_name}` by default or `memories_global` if explicitly designated and `hasGlobalAccess: true`.
4. **Read/Search Path:** Merge, rank, and return top-$k$ results from the permitted datasets (`agent_db` + `global_db` where applicable).
5. **Documentation & Licensing:** Maintain the MIT License in the repository root and include an explicit acknowledgment to the PLUR Memory project (`http://linkhere.github.com`) in the main `README.md`.