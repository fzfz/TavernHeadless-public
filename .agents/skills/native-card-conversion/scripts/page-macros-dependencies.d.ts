declare module "seedrandom" {
  export default function seedrandom(
    seed: string,
    options: { entropy: boolean },
  ): () => number;
}
