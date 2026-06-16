import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  Point: a
    .model({
      date: a.string().required(),
      time: a.string().required(),
      location: a.string().required(),
      lng: a.float().required(),
      lat: a.float().required(),
      description: a.string().required(),
    })
    .authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
