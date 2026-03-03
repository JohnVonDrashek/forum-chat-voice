export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string | null
          avatar_url: string | null
          bio: string | null
          website: string | null
          is_admin: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          website?: string | null
          is_admin?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          username?: string
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          website?: string | null
          is_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          sort_order?: number
          created_at?: string
        }
        Update: {
          name?: string
          slug?: string
          description?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      threads: {
        Row: {
          id: string
          category_id: string
          author_id: string
          title: string
          slug: string
          content: string | null
          image_url: string | null
          is_pinned: boolean
          is_locked: boolean
          view_count: number
          post_count: number
          last_post_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          category_id: string
          author_id: string
          title: string
          slug: string
          content?: string | null
          image_url?: string | null
          is_pinned?: boolean
          is_locked?: boolean
          view_count?: number
          post_count?: number
          last_post_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          title?: string
          slug?: string
          content?: string | null
          image_url?: string | null
          is_pinned?: boolean
          is_locked?: boolean
          view_count?: number
          post_count?: number
          last_post_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          }
        ]
      }
      posts: {
        Row: {
          id: string
          thread_id: string
          author_id: string
          content: string
          reply_to_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          thread_id: string
          author_id: string
          content: string
          reply_to_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          content?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_channels: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          slug?: string
          description?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          id: string
          channel_id: string
          author_id: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          author_id: string
          content: string
          created_at?: string
        }
        Update: {
          content?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      direct_messages: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string
          content: string
          read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          sender_id: string
          recipient_id: string
          content: string
          read?: boolean
          created_at?: string
        }
        Update: {
          read?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      voice_rooms: {
        Row: {
          id: string
          name: string
          slug: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          created_at?: string
        }
        Update: {
          name?: string
          slug?: string
        }
        Relationships: []
      }
      bookmarks: {
        Row: {
          id: string
          user_id: string
          thread_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          thread_id: string
          created_at?: string
        }
        Update: {}
        Relationships: [
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookmarks_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          message: string
          link: string | null
          read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          message: string
          link?: string | null
          read?: boolean
          created_at?: string
        }
        Update: {
          read?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Category = Database['public']['Tables']['categories']['Row']
export type Thread = Database['public']['Tables']['threads']['Row']
export type Post = Database['public']['Tables']['posts']['Row']
export type ChatChannel = Database['public']['Tables']['chat_channels']['Row']
export type ChatMessage = Database['public']['Tables']['chat_messages']['Row']
export type DirectMessage = Database['public']['Tables']['direct_messages']['Row']
export type VoiceRoom = Database['public']['Tables']['voice_rooms']['Row']
export type Bookmark = Database['public']['Tables']['bookmarks']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']

// Insert types
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ThreadInsert = Database['public']['Tables']['threads']['Insert']
export type PostInsert = Database['public']['Tables']['posts']['Insert']
export type ChatMessageInsert = Database['public']['Tables']['chat_messages']['Insert']
export type DirectMessageInsert = Database['public']['Tables']['direct_messages']['Insert']
export type BookmarkInsert = Database['public']['Tables']['bookmarks']['Insert']

// Extended types with joins
export interface ThreadWithAuthor extends Thread {
  author: Profile
  category: Category
}

export interface PostWithAuthor extends Post {
  author: Profile
}

export interface ChatMessageWithAuthor extends ChatMessage {
  author: Profile
}
