export const createRoleAssetsBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["character_id", "files"],
  properties: {
    character_id: { type: "string", minLength: 1 },
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "mime", "base64"],
        properties: {
          name: { type: "string", minLength: 1 },
          mime: { type: "string", minLength: 1 },
          base64: { type: "string" },
        },
      },
    },
  },
};
