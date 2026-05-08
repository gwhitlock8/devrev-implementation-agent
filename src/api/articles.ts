import type { DevRevHttpClient } from "./client.js";

export type ArticleRecord = {
  id?: string;
  display_id?: string;
  title?: string;
  body?: string;
  status?: string;
  language?: string;
};

export async function articlesCreate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ article?: ArticleRecord }> {
  return client.post("articles.create", body);
}

export async function articlesUpdate(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ article?: ArticleRecord }> {
  return client.post("articles.update", body);
}

export async function articlesListPost(
  client: DevRevHttpClient,
  body: Record<string, unknown>,
): Promise<{ articles?: ArticleRecord[]; next_cursor?: string }> {
  return client.post("articles.list", body);
}

export async function articlesGet(
  client: DevRevHttpClient,
  id: string,
): Promise<{ article?: ArticleRecord }> {
  return client.get("articles.get", { id });
}
