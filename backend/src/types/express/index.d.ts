
import 'express';

// By using declaration merging, we can extend the Express Request interface
// to include a custom property 'id' which we add in our logging middleware.
// This provides type safety and removes the need for @ts-ignore.
declare global {
  namespace Express {
    export interface Request {
      id?: string;
    }
  }
}