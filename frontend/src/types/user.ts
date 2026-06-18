export interface UserSummary {
  userId: string
  username: string
  nickname: string
  avatarUrl: string
}

export interface UserStats {
  worldsCreated: number
  contributions: number
  followers: number
}

export interface CurrentUser {
  userId: string
  username: string
  nickname: string
  avatarUrl: string
  bio: string | null
  createdAt: string
  stats: UserStats
}

export interface UploadImageResponse {
  fileName: string
  url: string
}
