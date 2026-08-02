export type NewsCategory = 'Politics' | 'Business' | 'Technology' | 'Entertainment' | 'Sports' | 'Health' | 'Education' | 'Africa' | 'World' | 'Ghana' | 'General';

export interface NormalizedNewsArticle {
  title: string; description: string; content?: string; image?: string; source: string;
  sourceSlug: string; author?: string; publishedAt: string; updatedAt?: string;
  category: NewsCategory; country: string; url: string; externalId: string;
  videoUrl?: string; youtubeUrl?: string; durationSeconds?: number; raw?: unknown;
}
export interface SourceDefinition {
  slug: string; name: string; sourceType: 'rss' | 'api'; feedUrl?: string; apiEndpoint?: string;
  apiSecretName?: string; country: string; category: NewsCategory; enabled: boolean;
}
export interface NewsProvider { source: SourceDefinition; fetch(): Promise<NormalizedNewsArticle[]>; }
