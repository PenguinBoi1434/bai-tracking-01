import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  Point: a
    .model({
      date: a.string().required(),
      time: a.string(),
      location: a.string(),
      lng: a.float().required(),
      lat: a.float().required(),
      description: a.string(),
      photos: a.string().array(),
      timezone: a.string(),
      comments: a.string().array(),
      category: a.string(),
    })
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
