import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito auth: users sign up / sign in with their email address.
 * Email verification and password reset are enabled by default.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
