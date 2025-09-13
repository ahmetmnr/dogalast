/**
 * Authentication types
 */

export interface ContextWithAuth {
  user?: {
    id: string;
    name: string;
    role: string;
  };
}
