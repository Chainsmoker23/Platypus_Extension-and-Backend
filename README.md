# Platypus AI Development System

This repository contains the source code for the Platypus AI system, an AI-powered code modification engine for VS Code. The system is composed of two main parts:

1.  **`backend/`**: A Node.js/Express service that communicates with the Google Gemini API to analyze code and generate diffs.
2.  **`extension/`**: The VS Code extension itself, which includes a React-based WebUI for user interaction.

## Prerequisites

- Node.js (v18 or later)
- npm
- VS Code

## Setup & Running the System

The project is configured as a VS Code multi-root workspace to provide a seamless, one-click debugging experience for both the backend and the extension.

### 1. Initial Project Setup

1.  **Install Backend Dependencies:**
    -   Navigate to the backend directory and install its dependencies.
        ```bash
        cd backend
        npm install
        cd ..
        ```

2.  **Install Extension Dependencies:**
    -   Navigate to the extension and WebUI directories and install their dependencies.
        ```bash
        cd extension
        npm install
        cd web-ui
        npm install
        cd ../..
        ```

3.  **Configure Backend Environment Variables:**
    -   In the `backend/` directory, copy the example environment file:
        ```bash
        cp backend/.env.example backend/.env
        ```
    -   Open the newly created `backend/.env` file and add your Google Gemini API key:
        ```
        API_KEY="YOUR_GEMINI_API_KEY_HERE"
        ```

4.  **Build the WebUI:**
    -   Run the build command for the React UI. This compiles the static assets that the extension serves.
        ```bash
        npm run build --workspace=extension/web-ui
        ```

### 2. Running the System in VS Code

1.  **Open the Workspace:**
    -   Open VS Code.
    -   Go to `File > Open Workspace from File...`
    -   Select the `platypus.code-workspace` file located in the root of this project.

2.  **Start Debugging:**
    -   Press `F5` or go to `Run > Start Debugging`.
    -   Ensure that the selected launch configuration is **"Launch Backend & Extension"**.

This single action will:
-   Automatically compile the extension's TypeScript code.
-   Start the backend server in a debug-enabled terminal.
-   Launch a new "Extension Development Host" window with the Platypus AI extension installed and activated.

The full end-to-end system is now running and ready for debugging. Any changes you make to the backend or extension code will be picked up by their respective hot-reload or watch processes.
