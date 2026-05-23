import postgres, { type Sql } from "postgres";

export type Db = Sql;

export const createDb = (connectionString: string): Db =>
  postgres(connectionString, {
    max: 8,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
