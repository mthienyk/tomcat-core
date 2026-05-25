export type EmbeddingProvider = {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
};

export type EmbeddingRegistry = {
  defaultProvider(): EmbeddingProvider | undefined;
};
