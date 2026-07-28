export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          agency_id: string
          body: string
          contact_id: string | null
          created_at: string
          file_id: string | null
          id: string
          lead_id: string | null
          member_id: string | null
          metadata: Json
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          agency_id: string
          body: string
          contact_id?: string | null
          created_at?: string
          file_id?: string | null
          id?: string
          lead_id?: string | null
          member_id?: string | null
          metadata?: Json
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          agency_id?: string
          body?: string
          contact_id?: string | null
          created_at?: string
          file_id?: string | null
          id?: string
          lead_id?: string | null
          member_id?: string | null
          metadata?: Json
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activities_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_file_fk"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "file_totals"
            referencedColumns: ["file_id"]
          },
          {
            foreignKeyName: "activities_file_fk"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      agencies: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          email: string | null
          file_seq: number
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          quote_seq: number
          receipt_seq: number
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          file_seq?: number
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          quote_seq?: number
          receipt_seq?: number
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          file_seq?: number
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          quote_seq?: number
          receipt_seq?: number
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      attachments: {
        Row: {
          agency_id: string
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          id: string
          mime_type: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          id?: string
          mime_type?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          agency_id: string
          color: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          phone: string | null
          position: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          agency_id: string
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          phone?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          agency_id?: string
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          phone?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          agency_id: string
          contact_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          agency_id: string
          contact_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          agency_id?: string
          contact_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          address: string | null
          agency_id: string
          birth_date: string | null
          city: string | null
          created_at: string
          document_number: string | null
          document_type: Database["public"]["Enums"]["document_type"] | null
          email: string | null
          full_name: string
          id: string
          instagram: string | null
          is_client: boolean
          notes: string | null
          phone: string | null
          source: Database["public"]["Enums"]["lead_channel"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          agency_id: string
          birth_date?: string | null
          city?: string | null
          created_at?: string
          document_number?: string | null
          document_type?: Database["public"]["Enums"]["document_type"] | null
          email?: string | null
          full_name: string
          id?: string
          instagram?: string | null
          is_client?: boolean
          notes?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["lead_channel"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          agency_id?: string
          birth_date?: string | null
          city?: string | null
          created_at?: string
          document_number?: string | null
          document_type?: Database["public"]["Enums"]["document_type"] | null
          email?: string | null
          full_name?: string
          id?: string
          instagram?: string | null
          is_client?: boolean
          notes?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["lead_channel"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agency_id: string
          assigned_to: string | null
          branch_id: string | null
          channel: Database["public"]["Enums"]["lead_channel"]
          channel_id: string | null
          contact_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          origin_conversation_id: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
          wa_id: string | null
        }
        Insert: {
          agency_id: string
          assigned_to?: string | null
          branch_id?: string | null
          channel?: Database["public"]["Enums"]["lead_channel"]
          channel_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          origin_conversation_id?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
          wa_id?: string | null
        }
        Update: {
          agency_id?: string
          assigned_to?: string | null
          branch_id?: string | null
          channel?: Database["public"]["Enums"]["lead_channel"]
          channel_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          origin_conversation_id?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
          wa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "wa_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_origin_conversation_id_fkey"
            columns: ["origin_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_services: {
        Row: {
          agency_id: string
          cost: number
          created_at: string
          date_from: string | null
          date_to: string | null
          deadline_date: string | null
          description: string
          file_id: string
          id: string
          images: Json
          paid_to_supplier: boolean
          position: number
          price: number
          reservation_code: string | null
          supplier_id: string | null
          type: Database["public"]["Enums"]["service_type"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          cost?: number
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          deadline_date?: string | null
          description: string
          file_id: string
          id?: string
          images?: Json
          paid_to_supplier?: boolean
          position?: number
          price?: number
          reservation_code?: string | null
          supplier_id?: string | null
          type: Database["public"]["Enums"]["service_type"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          cost?: number
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          deadline_date?: string | null
          description?: string
          file_id?: string
          id?: string
          images?: Json
          paid_to_supplier?: boolean
          position?: number
          price?: number
          reservation_code?: string | null
          supplier_id?: string | null
          type?: Database["public"]["Enums"]["service_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_services_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_services_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "file_totals"
            referencedColumns: ["file_id"]
          },
          {
            foreignKeyName: "file_services_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_services_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      file_travelers: {
        Row: {
          agency_id: string
          file_id: string
          traveler_id: string
        }
        Insert: {
          agency_id: string
          file_id: string
          traveler_id: string
        }
        Update: {
          agency_id?: string
          file_id?: string
          traveler_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_travelers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_travelers_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "file_totals"
            referencedColumns: ["file_id"]
          },
          {
            foreignKeyName: "file_travelers_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_travelers_traveler_id_fkey"
            columns: ["traveler_id"]
            isOneToOne: false
            referencedRelation: "travelers"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          agency_id: string
          branch_id: string | null
          code: string
          commission_amount: number
          commission_label: string | null
          commission_pct: number
          commission_type: string
          contact_id: string
          created_at: string
          currency: string
          departure_date: string | null
          destination: string
          id: string
          lead_id: string | null
          notes: string | null
          number: number
          quote_id: string | null
          return_date: string | null
          review_status: Database["public"]["Enums"]["file_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          seller_id: string | null
          status: Database["public"]["Enums"]["file_status"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          branch_id?: string | null
          code?: string
          commission_amount?: number
          commission_label?: string | null
          commission_pct?: number
          commission_type?: string
          contact_id: string
          created_at?: string
          currency?: string
          departure_date?: string | null
          destination: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          number?: number
          quote_id?: string | null
          return_date?: string | null
          review_status?: Database["public"]["Enums"]["file_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["file_status"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          branch_id?: string | null
          code?: string
          commission_amount?: number
          commission_label?: string | null
          commission_pct?: number
          commission_type?: string
          contact_id?: string
          created_at?: string
          currency?: string
          departure_date?: string | null
          destination?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          number?: number
          quote_id?: string | null
          return_date?: string | null
          review_status?: Database["public"]["Enums"]["file_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["file_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_rules: {
        Row: {
          agency_id: string
          applies_to_stages: Database["public"]["Enums"]["lead_stage"][]
          created_at: string
          hours_after_silence: number
          id: string
          is_active: boolean
          touch_number: number
        }
        Insert: {
          agency_id: string
          applies_to_stages: Database["public"]["Enums"]["lead_stage"][]
          created_at?: string
          hours_after_silence: number
          id?: string
          is_active?: boolean
          touch_number: number
        }
        Update: {
          agency_id?: string
          applies_to_stages?: Database["public"]["Enums"]["lead_stage"][]
          created_at?: string
          hours_after_silence?: number
          id?: string
          is_active?: boolean
          touch_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "followup_rules_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          agency_id: string
          conversation_id: string | null
          created_at: string
          id: string
          lead_id: string
          rule_id: string | null
          scheduled_at: string
          sent_at: string | null
          sent_message_id: string | null
          status: Database["public"]["Enums"]["followup_status"]
          template_id: string | null
          touch_number: number
        }
        Insert: {
          agency_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          rule_id?: string | null
          scheduled_at: string
          sent_at?: string | null
          sent_message_id?: string | null
          status?: Database["public"]["Enums"]["followup_status"]
          template_id?: string | null
          touch_number?: number
        }
        Update: {
          agency_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          rule_id?: string | null
          scheduled_at?: string
          sent_at?: string | null
          sent_message_id?: string | null
          status?: Database["public"]["Enums"]["followup_status"]
          template_id?: string | null
          touch_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "followups_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "followup_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_sent_message_id_fkey"
            columns: ["sent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "wa_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          agency_id: string
          commission_pct: number
          created_at: string
          display_name: string | null
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
        }
        Insert: {
          accepted_at?: string | null
          agency_id: string
          commission_pct?: number
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
        }
        Update: {
          accepted_at?: string | null
          agency_id?: string
          commission_pct?: number
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "invitations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          agency_id: string
          assigned_to: string | null
          branch_id: string | null
          budget_currency: string
          budget_estimate: number | null
          closed_at: string | null
          contact_id: string
          created_at: string
          destination: string | null
          followups_paused: boolean
          id: string
          initial_message: string | null
          lost_reason: string | null
          next_action: string | null
          next_action_at: string | null
          origin_ad_id: string | null
          origin_campaign: string | null
          origin_channel: Database["public"]["Enums"]["lead_channel"]
          pax_adults: number
          pax_children: number
          position: number
          stage: Database["public"]["Enums"]["lead_stage"]
          trip_date_from: string | null
          trip_date_to: string | null
          trip_type: Database["public"]["Enums"]["trip_type"] | null
          updated_at: string
          won_file_id: string | null
        }
        Insert: {
          agency_id: string
          assigned_to?: string | null
          branch_id?: string | null
          budget_currency?: string
          budget_estimate?: number | null
          closed_at?: string | null
          contact_id: string
          created_at?: string
          destination?: string | null
          followups_paused?: boolean
          id?: string
          initial_message?: string | null
          lost_reason?: string | null
          next_action?: string | null
          next_action_at?: string | null
          origin_ad_id?: string | null
          origin_campaign?: string | null
          origin_channel?: Database["public"]["Enums"]["lead_channel"]
          pax_adults?: number
          pax_children?: number
          position?: number
          stage?: Database["public"]["Enums"]["lead_stage"]
          trip_date_from?: string | null
          trip_date_to?: string | null
          trip_type?: Database["public"]["Enums"]["trip_type"] | null
          updated_at?: string
          won_file_id?: string | null
        }
        Update: {
          agency_id?: string
          assigned_to?: string | null
          branch_id?: string | null
          budget_currency?: string
          budget_estimate?: number | null
          closed_at?: string | null
          contact_id?: string
          created_at?: string
          destination?: string | null
          followups_paused?: boolean
          id?: string
          initial_message?: string | null
          lost_reason?: string | null
          next_action?: string | null
          next_action_at?: string | null
          origin_ad_id?: string | null
          origin_campaign?: string | null
          origin_channel?: Database["public"]["Enums"]["lead_channel"]
          pax_adults?: number
          pax_children?: number
          position?: number
          stage?: Database["public"]["Enums"]["lead_stage"]
          trip_date_from?: string | null
          trip_date_to?: string | null
          trip_type?: Database["public"]["Enums"]["trip_type"] | null
          updated_at?: string
          won_file_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_won_file_fk"
            columns: ["won_file_id"]
            isOneToOne: false
            referencedRelation: "file_totals"
            referencedColumns: ["file_id"]
          },
          {
            foreignKeyName: "leads_won_file_fk"
            columns: ["won_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          agency_id: string
          avatar_url: string | null
          branch_id: string | null
          commission_pct: number
          created_at: string
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          avatar_url?: string | null
          branch_id?: string | null
          commission_pct?: number
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          avatar_url?: string | null
          branch_id?: string | null
          commission_pct?: number
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agency_id: string
          body: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          error_detail: string | null
          id: string
          is_automated: boolean
          kind: Database["public"]["Enums"]["message_kind"]
          media_url: string | null
          metadata: Json
          sent_by: string | null
          status: Database["public"]["Enums"]["message_status"]
          template_name: string | null
          wa_message_id: string | null
        }
        Insert: {
          agency_id: string
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          error_detail?: string | null
          id?: string
          is_automated?: boolean
          kind?: Database["public"]["Enums"]["message_kind"]
          media_url?: string | null
          metadata?: Json
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          template_name?: string | null
          wa_message_id?: string | null
        }
        Update: {
          agency_id?: string
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          error_detail?: string | null
          id?: string
          is_automated?: boolean
          kind?: Database["public"]["Enums"]["message_kind"]
          media_url?: string | null
          metadata?: Json
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          template_name?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agency_id: string
          body: string | null
          created_at: string
          id: string
          link: string | null
          member_id: string
          read_at: string | null
          title: string
          type: string
        }
        Insert: {
          agency_id: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          member_id: string
          read_at?: string | null
          title: string
          type?: string
        }
        Update: {
          agency_id?: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          member_id?: string
          read_at?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          agency_id: string
          amount: number
          amount_in_file_currency: number
          contact_id: string | null
          created_at: string
          currency: string
          direction: Database["public"]["Enums"]["payment_direction"]
          exchange_rate: number | null
          file_id: string | null
          id: string
          member_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          receipt_code: string | null
          receipt_number: number | null
          receipt_token: string
          received_by: string | null
          supplier_id: string | null
        }
        Insert: {
          agency_id: string
          amount: number
          amount_in_file_currency: number
          contact_id?: string | null
          created_at?: string
          currency?: string
          direction?: Database["public"]["Enums"]["payment_direction"]
          exchange_rate?: number | null
          file_id?: string | null
          id?: string
          member_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          receipt_code?: string | null
          receipt_number?: number | null
          receipt_token?: string
          received_by?: string | null
          supplier_id?: string | null
        }
        Update: {
          agency_id?: string
          amount?: number
          amount_in_file_currency?: number
          contact_id?: string | null
          created_at?: string
          currency?: string
          direction?: Database["public"]["Enums"]["payment_direction"]
          exchange_rate?: number | null
          file_id?: string | null
          id?: string
          member_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          receipt_code?: string | null
          receipt_number?: number | null
          receipt_token?: string
          received_by?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "file_totals"
            referencedColumns: ["file_id"]
          },
          {
            foreignKeyName: "payments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          agency_id: string
          commission_pct: number
          cost: number
          created_at: string
          description: string
          gross: number | null
          id: string
          option_id: string | null
          position: number
          quote_id: string
          show_in_client_quote: boolean
          supplier_id: string | null
          type: Database["public"]["Enums"]["service_type"]
        }
        Insert: {
          agency_id: string
          commission_pct?: number
          cost?: number
          created_at?: string
          description: string
          gross?: number | null
          id?: string
          option_id?: string | null
          position?: number
          quote_id: string
          show_in_client_quote?: boolean
          supplier_id?: string | null
          type: Database["public"]["Enums"]["service_type"]
        }
        Update: {
          agency_id?: string
          commission_pct?: number
          cost?: number
          created_at?: string
          description?: string
          gross?: number | null
          id?: string
          option_id?: string | null
          position?: number
          quote_id?: string
          show_in_client_quote?: boolean
          supplier_id?: string | null
          type?: Database["public"]["Enums"]["service_type"]
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "quote_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_options: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          is_recommended: boolean
          name: string
          per_person: number
          position: number
          quote_id: string
          subtitle: string | null
          total_cost: number
          total_price: number
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          is_recommended?: boolean
          name: string
          per_person?: number
          position?: number
          quote_id: string
          subtitle?: string | null
          total_cost?: number
          total_price?: number
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          is_recommended?: boolean
          name?: string
          per_person?: number
          position?: number
          quote_id?: string
          subtitle?: string | null
          total_cost?: number
          total_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_options_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_options_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          accepted_option_id: string | null
          agency_id: string
          children_ages: Json
          code: string
          commission_total: number
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          destination: string
          discount: number
          file_id: string | null
          id: string
          internal_notes: string | null
          lead_id: string | null
          markup_type: string
          markup_value: number
          nights: number | null
          notes: string | null
          number: number
          pax: number
          pax_adults: number
          pax_children: number
          pax_infants: number
          public_token: string
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          theme: Json
          title: string | null
          total_cost: number
          total_price: number
          trip_date_from: string | null
          trip_date_to: string | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_option_id?: string | null
          agency_id: string
          children_ages?: Json
          code?: string
          commission_total?: number
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          destination: string
          discount?: number
          file_id?: string | null
          id?: string
          internal_notes?: string | null
          lead_id?: string | null
          markup_type?: string
          markup_value?: number
          nights?: number | null
          notes?: string | null
          number?: number
          pax?: number
          pax_adults?: number
          pax_children?: number
          pax_infants?: number
          public_token?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          theme?: Json
          title?: string | null
          total_cost?: number
          total_price?: number
          trip_date_from?: string | null
          trip_date_to?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_option_id?: string | null
          agency_id?: string
          children_ages?: Json
          code?: string
          commission_total?: number
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          destination?: string
          discount?: number
          file_id?: string | null
          id?: string
          internal_notes?: string | null
          lead_id?: string | null
          markup_type?: string
          markup_value?: number
          nights?: number | null
          notes?: string | null
          number?: number
          pax?: number
          pax_adults?: number
          pax_children?: number
          pax_infants?: number
          public_token?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          theme?: Json
          title?: string | null
          total_cost?: number
          total_price?: number
          trip_date_from?: string | null
          trip_date_to?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_accepted_option_id_fkey"
            columns: ["accepted_option_id"]
            isOneToOne: false
            referencedRelation: "quote_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_file_fk"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "file_totals"
            referencedColumns: ["file_id"]
          },
          {
            foreignKeyName: "quotes_file_fk"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_rules: {
        Row: {
          agency_id: string
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          match_type: string
          pattern: string
          position: number
        }
        Insert: {
          agency_id: string
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          match_type?: string
          pattern: string
          position?: number
        }
        Update: {
          agency_id?: string
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          match_type?: string
          pattern?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "routing_rules_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_rules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          agency_id: string
          created_at: string
          default_commission_pct: number
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          website: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          default_commission_pct?: number
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          website?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          default_commission_pct?: number
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          agency_id: string
          category: string
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          agency_id: string
          category?: string
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          agency_id?: string
          category?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      travelers: {
        Row: {
          agency_id: string
          birth_date: string | null
          contact_id: string
          created_at: string
          document_expiry: string | null
          document_number: string | null
          document_type: Database["public"]["Enums"]["document_type"] | null
          full_name: string
          id: string
          linked_contact_id: string | null
          notes: string | null
          relationship: string | null
          updated_at: string
        }
        Insert: {
          agency_id: string
          birth_date?: string | null
          contact_id: string
          created_at?: string
          document_expiry?: string | null
          document_number?: string | null
          document_type?: Database["public"]["Enums"]["document_type"] | null
          full_name: string
          id?: string
          linked_contact_id?: string | null
          notes?: string | null
          relationship?: string | null
          updated_at?: string
        }
        Update: {
          agency_id?: string
          birth_date?: string | null
          contact_id?: string
          created_at?: string
          document_expiry?: string | null
          document_number?: string | null
          document_type?: Database["public"]["Enums"]["document_type"] | null
          full_name?: string
          id?: string
          linked_contact_id?: string | null
          notes?: string | null
          relationship?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "travelers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travelers_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travelers_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_channels: {
        Row: {
          agency_id: string
          auto_reply_enabled: boolean
          auto_reply_text: string | null
          branch_id: string | null
          created_at: string
          id: string
          is_mother: boolean
          kind: Database["public"]["Enums"]["wa_channel_kind"]
          label: string
          last_connected_at: string | null
          last_error: string | null
          phone: string | null
          phone_number_id: string | null
          qr: string | null
          qr_expires_at: string | null
          status: Database["public"]["Enums"]["wa_channel_status"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          auto_reply_enabled?: boolean
          auto_reply_text?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          is_mother?: boolean
          kind?: Database["public"]["Enums"]["wa_channel_kind"]
          label: string
          last_connected_at?: string | null
          last_error?: string | null
          phone?: string | null
          phone_number_id?: string | null
          qr?: string | null
          qr_expires_at?: string | null
          status?: Database["public"]["Enums"]["wa_channel_status"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          auto_reply_enabled?: boolean
          auto_reply_text?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          is_mother?: boolean
          kind?: Database["public"]["Enums"]["wa_channel_kind"]
          label?: string
          last_connected_at?: string | null
          last_error?: string | null
          phone?: string | null
          phone_number_id?: string | null
          qr?: string | null
          qr_expires_at?: string | null
          status?: Database["public"]["Enums"]["wa_channel_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_channels_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_channels_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_session_state: {
        Row: {
          channel_id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          channel_id: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          channel_id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "wa_session_state_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "wa_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_templates: {
        Row: {
          agency_id: string
          body: string
          created_at: string
          id: string
          is_approved: boolean
          language: string
          meta_name: string
          name: string
          stage: Database["public"]["Enums"]["lead_stage"] | null
        }
        Insert: {
          agency_id: string
          body: string
          created_at?: string
          id?: string
          is_approved?: boolean
          language?: string
          meta_name: string
          name: string
          stage?: Database["public"]["Enums"]["lead_stage"] | null
        }
        Update: {
          agency_id?: string
          body?: string
          created_at?: string
          id?: string
          is_approved?: boolean
          language?: string
          meta_name?: string
          name?: string
          stage?: Database["public"]["Enums"]["lead_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_templates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      file_totals: {
        Row: {
          agency_id: string | null
          balance: number | null
          file_id: string | null
          paid_total: number | null
          total_cost: number | null
          total_sale: number | null
          utility: number | null
        }
        Relationships: [
          {
            foreignKeyName: "files_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      quote_public: { Args: { token: string }; Returns: Json }
      receipt_public: { Args: { token: string }; Returns: Json }
    }
    Enums: {
      activity_type:
        | "nota"
        | "llamada"
        | "whatsapp"
        | "email"
        | "etapa"
        | "presupuesto"
        | "sistema"
      conversation_status: "abierta" | "cerrada" | "spam"
      document_type: "dni" | "pasaporte" | "visa" | "otro"
      file_review_status: "pendiente" | "revisado"
      file_status:
        | "vendido"
        | "pagado"
        | "en_curso"
        | "finalizado"
        | "cancelado"
      followup_status: "pendiente" | "enviado" | "cancelado" | "fallido"
      lead_channel:
        | "whatsapp"
        | "instagram"
        | "messenger"
        | "lead_form"
        | "web"
        | "referido"
        | "manual"
      lead_stage:
        | "nuevo"
        | "contactado"
        | "presupuestado"
        | "negociacion"
        | "ganado"
        | "perdido"
      member_role: "admin" | "vendedor" | "freelance"
      message_direction: "in" | "out"
      message_kind:
        | "texto"
        | "plantilla"
        | "imagen"
        | "documento"
        | "audio"
        | "video"
        | "nota_interna"
      message_status:
        | "pendiente"
        | "enviado"
        | "entregado"
        | "leido"
        | "fallido"
      payment_direction:
        | "cobro"
        | "pago_proveedor"
        | "reembolso"
        | "pago_comision"
      payment_method:
        | "efectivo"
        | "transferencia"
        | "tarjeta"
        | "mercado_pago"
        | "deposito"
        | "otro"
      quote_status:
        | "borrador"
        | "enviado"
        | "aceptado"
        | "rechazado"
        | "vencido"
      service_type:
        | "aereo"
        | "hotel"
        | "paquete"
        | "excursion"
        | "traslado"
        | "asistencia"
        | "circuito"
        | "crucero"
        | "otro"
      trip_type: "familiar" | "pareja" | "grupal" | "corporativo" | "solo"
      wa_channel_kind: "cloud_api" | "baileys"
      wa_channel_status: "desconectado" | "vinculando" | "conectado" | "error"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "nota",
        "llamada",
        "whatsapp",
        "email",
        "etapa",
        "presupuesto",
        "sistema",
      ],
      conversation_status: ["abierta", "cerrada", "spam"],
      document_type: ["dni", "pasaporte", "visa", "otro"],
      file_review_status: ["pendiente", "revisado"],
      file_status: ["vendido", "pagado", "en_curso", "finalizado", "cancelado"],
      followup_status: ["pendiente", "enviado", "cancelado", "fallido"],
      lead_channel: [
        "whatsapp",
        "instagram",
        "messenger",
        "lead_form",
        "web",
        "referido",
        "manual",
      ],
      lead_stage: [
        "nuevo",
        "contactado",
        "presupuestado",
        "negociacion",
        "ganado",
        "perdido",
      ],
      member_role: ["admin", "vendedor", "freelance"],
      message_direction: ["in", "out"],
      message_kind: [
        "texto",
        "plantilla",
        "imagen",
        "documento",
        "audio",
        "video",
        "nota_interna",
      ],
      message_status: ["pendiente", "enviado", "entregado", "leido", "fallido"],
      payment_direction: [
        "cobro",
        "pago_proveedor",
        "reembolso",
        "pago_comision",
      ],
      payment_method: [
        "efectivo",
        "transferencia",
        "tarjeta",
        "mercado_pago",
        "deposito",
        "otro",
      ],
      quote_status: ["borrador", "enviado", "aceptado", "rechazado", "vencido"],
      service_type: [
        "aereo",
        "hotel",
        "paquete",
        "excursion",
        "traslado",
        "asistencia",
        "circuito",
        "crucero",
        "otro",
      ],
      trip_type: ["familiar", "pareja", "grupal", "corporativo", "solo"],
      wa_channel_kind: ["cloud_api", "baileys"],
      wa_channel_status: ["desconectado", "vinculando", "conectado", "error"],
    },
  },
} as const
