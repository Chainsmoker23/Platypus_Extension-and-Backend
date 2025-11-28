# Platypus AI Development System

This repository contains the source code for the Platypus AI system, an AI-powered code modification engine for VS Code. The system is composed of two main parts:

1.  **`backend/`**: A Node.js/Express service that communicates with the Google Gemini API to analyze code and generate diffs.
2.  **`extension/`**: The VS Code extension itself, which includes a React-based WebUI for user interaction.

## Prerequisites

- Node.js (v18 or later)
- npm
- VS Code

## Setup & Running the System

To run the full Platypus system locally, you need to run both the backend service and the VS Code extension.

### 1. Backend Setup

The backend service handles all communication with the AI model.

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    -   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    -   Open the newly created `.env` file in a text editor.
    -   Add your Google Gemini API key:
        ```
        API_KEY="YOUR_GEMINI_API_KEY_HERE"
        ```

4.  **Run the backend server:**
    ```bash
    npm run dev
    ```

    The backend server will start, typically on `http://localhost:3001`. Keep this terminal window open.

### 2. VS Code Extension Setup

The extension provides the user interface and interacts with your workspace files.

1.  **Open the extension project in VS Code:**
    -   Open a new VS Code window.
    -   Go to `File > Open Folder...` and select the `extension/` directory from this repository.

2.  **Install dependencies:**
    -   Open the integrated terminal in VS Code (`Ctrl+\`` or `Cmd+\``).
    -   Install the extension's dependencies:
        ```bash
        npm install
        ```
    -   Navigate to the WebUI directory and install its dependencies:
        ```bash
        cd web-ui
        npm install
        ```

3.  **Build the WebUI:**
    -   While still in the `extension/web-ui` directory, run the build command. This compiles the React app into static assets that the extension can serve.
        ```bash
        npm run build
        ```
    -   Navigate back to the extension root:
        ```bash
        cd ..
        ```

4.  **Compile the Extension:**
    -   Compile the extension's TypeScript code:
        ```bash
        npm run compile
        ```
    -   Or, to watch for changes and recompile automatically:
        ```bash
        npm run watch
        ```

5.  **Run the Extension in Debug Mode:**
    -   Press `F5` to open a new "Extension Development Host" window. This new VS Code window will have the Platypus extension installed and activated.
    -   In the new window, open any of your personal code projects.
    -   Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and type `Start Platypus AI Analysis`.
    -   The Platypus UI will open in a new tab, and you can begin using it to analyze your code.

The full end-to-end system is now running.
