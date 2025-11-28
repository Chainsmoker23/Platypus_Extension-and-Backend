
import type { AnalysisResult } from './types';

const appTsDiff = `--- a/src/components/App.tsx
+++ b/src/components/App.tsx
@@ -1,19 +1,28 @@
-import React, { useState } from 'react';
+import React, { useReducer } from 'react';
 
-const App = () => {
-  const [count, setCount] = useState(0);
-  const [error, setError] = useState<string | null>(null);
+const initialState = { count: 0, error: null };
+
+function reducer(state, action) {
+  switch (action.type) {
+    case 'increment':
+      return { ...state, count: state.count + 1 };
+    case 'decrement':
+      return { ...state, count: state.count - 1 };
+    case 'setError':
+      return { ...state, error: action.payload };
+    default:
+      throw new Error();
+  }
+}
 
+const App = () => {
+  const [state, dispatch] = useReducer(reducer, initialState);
   return (
       <div>
-      <p>Count: {count}</p>
-      <button onClick={() => setCount(c => c + 1)}>Increment</button>
-      <button onClick={() => setCount(c => c - 1)}>Decrement</button>
-      {error && <p style={{ color: 'red' }}>{error}</p>}
+      <p>Count: {state.count}</p>
+      <button onClick={() => dispatch({ type: 'increment' })}>Increment</button>
+      <button onClick={() => dispatch({ type: 'decrement' })}>Decrement</button>
+      {state.error && <p style={{ color: 'red' }}>{state.error}</p>}
       </div>
     );
   };`;

const buttonTsxDiff = `--- a/src/components/Button.tsx
+++ b/src/components/Button.tsx
@@ -1,16 +1,14 @@
-import React from 'react';
+import React, { forwardRef } from 'react';
 
-interface ButtonProps {
+interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
   children: React.ReactNode;
-  onClick: () => void;
-  disabled?: boolean;
 }
 
-export const Button = ({ children, onClick, disabled }: ButtonProps) => {
-  return (
-    <button onClick={onClick} disabled={disabled}>
-      {children}
-    </button>
-  );
-};
+export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
+  ({ children, ...props }, ref) => {
+    return (
+      <button ref={ref} {...props}>
+        {children}
+      </button>
+    );
+  }
+);`;

export const MOCK_ANALYSIS_RESULT: Omit<AnalysisResult, 'changes'> & { changes: Omit<AnalysisResult['changes'][0], 'status'>[]} = {
  summary: 'I have analyzed your request to refactor the state management in `App.tsx` to use a reducer. This is a good practice for managing more complex state. I have also identified an improvement in your `Button.tsx` component to make it more flexible by forwarding refs and accepting all standard button props. Here are the proposed changes.',
  changes: [
    {
      // FIX: Added missing 'operation' property to satisfy the discriminated union type.
      operation: 'modify',
      filePath: 'src/components/App.tsx',
      explanation: 'Refactors the component to use `useReducer` for more robust state management, combining `count` and `error` states into a single state object.',
      diff: appTsDiff,
    },
    {
      // FIX: Added missing 'operation' property to satisfy the discriminated union type.
      operation: 'modify',
      filePath: 'src/components/Button.tsx',
      explanation: 'Enhances the Button component by using `forwardRef` and spreading props, allowing it to accept any standard button attribute for better reusability.',
      diff: buttonTsxDiff,
    },
  ],
};
