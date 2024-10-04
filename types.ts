export type User = {
  user_id: string;
  name: string;
  email: string;
}

export type UrlEntry = {
  user_id: string;
  url: string;
  alias: string;
  permanent: boolean;
  visits: number;
  created_at: Date;
}