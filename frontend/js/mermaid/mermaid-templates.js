export const MERMAID_TEMPLATES = [
    {
        id: "basic-flowchart",
        name: "Basic Flowchart",
        type: "flowchart",
        source: `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process]
    B -->|No| D[End]`,
    },
    {
        id: "decision-tree",
        name: "Decision Tree",
        type: "flowchart",
        source: `flowchart TD
    A[Evaluate input] --> B{Meets criteria?}
    B -->|Yes| C[Approve]
    B -->|No| D{Can revise?}
    D -->|Yes| E[Request changes]
    D -->|No| F[Reject]`,
    },
    {
        id: "software-architecture",
        name: "Software Architecture",
        type: "flowchart",
        source: `flowchart LR
    UI[Web client] --> API[Django API]
    API --> DB[(SQLite)]
    API --> Jobs[AI jobs]
    Jobs --> Bridge[Import bridge]
    Bridge --> LLM[LLM provider]`,
    },
    {
        id: "api-request-flow",
        name: "API Request Flow",
        type: "sequenceDiagram",
        source: `sequenceDiagram
    participant User
    participant Client
    participant API
    participant Worker
    User->>Client: Submit request
    Client->>API: POST /api/task
    API->>Worker: Queue job
    Worker-->>API: Result
    API-->>Client: Response`,
    },
    {
        id: "cicd-pipeline",
        name: "CI/CD Pipeline",
        type: "flowchart",
        source: `flowchart LR
    A[Commit] --> B[Build]
    B --> C[Test]
    C --> D{Checks pass?}
    D -->|Yes| E[Deploy]
    D -->|No| F[Fix failures]
    F --> A`,
    },
    {
        id: "research-workflow",
        name: "Research Workflow",
        type: "flowchart",
        source: `flowchart TD
    A[Literature review] --> B[Hypothesis]
    B --> C[Experiment design]
    C --> D[Data collection]
    D --> E[Analysis]
    E --> F[Manuscript]`,
    },
    {
        id: "molecular-simulation",
        name: "Molecular Simulation Pipeline",
        type: "flowchart",
        source: `flowchart TD
    A[Prepare structure] --> B[Solvate and ionize]
    B --> C[Minimize energy]
    C --> D[Equilibrate]
    D --> E[Production MD]
    E --> F[Enhanced sampling]
    F --> G[Free energy analysis]`,
    },
    {
        id: "sequence",
        name: "Sequence Diagram",
        type: "sequenceDiagram",
        source: `sequenceDiagram
    participant Browser
    participant Server
    participant Database
    Browser->>Server: Save presentation
    Server->>Database: Persist JSON
    Database-->>Server: OK
    Server-->>Browser: Saved`,
    },
    {
        id: "gantt",
        name: "Gantt Timeline",
        type: "gantt",
        source: `gantt
    title Project timeline
    dateFormat  YYYY-MM-DD
    section Design
    Requirements      :a1, 2026-05-01, 5d
    Prototype         :after a1, 7d
    section Build
    Implementation    :2026-05-12, 10d
    Review            :2026-05-24, 4d`,
    },
    {
        id: "state",
        name: "State Diagram",
        type: "stateDiagram-v2",
        source: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review
    Review --> Approved
    Review --> Draft
    Approved --> Published
    Published --> [*]`,
    },
    {
        id: "er",
        name: "ER Diagram",
        type: "erDiagram",
        source: `erDiagram
    PRESENTATION ||--o{ SLIDE : contains
    SLIDE ||--o{ ELEMENT : has
    USER ||--o{ PRESENTATION : owns
    PRESENTATION {
        string id
        string title
    }`,
    },
    {
        id: "mindmap",
        name: "Mind Map",
        type: "mindmap",
        source: `mindmap
  root((SlideForge))
    Editor
      Canvas
      Properties
    Export
      PPTX
      JSON
    AI
      Import
      Cleanup`,
    },
];

export const DEFAULT_MERMAID_TEMPLATE = MERMAID_TEMPLATES[0];

export function inferMermaidType(source = "") {
    const first = String(source || "").trim().split(/\n+/)[0]?.trim() || "";
    if (/^sequenceDiagram\b/i.test(first)) return "sequenceDiagram";
    if (/^stateDiagram(?:-v2)?\b/i.test(first)) return "stateDiagram-v2";
    if (/^classDiagram\b/i.test(first)) return "classDiagram";
    if (/^erDiagram\b/i.test(first)) return "erDiagram";
    if (/^gantt\b/i.test(first)) return "gantt";
    if (/^journey\b/i.test(first)) return "journey";
    if (/^mindmap\b/i.test(first)) return "mindmap";
    return "flowchart";
}
