import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito auth: users sign up / sign in with their email address.
 * Email verification and password reset are enabled by default.
 *
 * Two custom attributes drive the 3-tier role system:
 *   custom:role     — "master" | "worker" | "field_worker"
 *   custom:projects — comma-separated Project IDs the user may access
 *                     (empty for master = sees all; one ID for field_worker)
 * An admin sets these per-user in the AWS Cognito Console.
 *
 * NOTE: No minLen/maxLen constraints — these must match the attributes
 * that were manually created in Cognito. Cognito does not allow deleting
 * or re-provisioning custom attributes with different properties.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    "custom:role": {
      dataType: "String",
      mutable: true,
    },
    "custom:projects": {
      dataType: "String",
      mutable: true,
    },
  },
});
