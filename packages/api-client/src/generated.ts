/* eslint-disable */
// This file is generated from FastAPI OpenAPI. Do not edit by hand.

export const openApiInfo = {
  "title": "Workout Tracker API",
  "version": "0.1.0"
} as const;

export const apiSchemaNames = [
  "CoinBalanceRead",
  "CoinRuleCreateRequest",
  "CoinRuleRead",
  "CoinRuleTrigger",
  "CoinRuleUpdateRequest",
  "CoinTransactionCreateRequest",
  "CoinTransactionRead",
  "CoinTransactionType",
  "DevicePlatform",
  "DeviceTokenRead",
  "DeviceTokenUpsertRequest",
  "EventCompletionRead",
  "EventCompletionRequest",
  "EventCreateRequest",
  "EventRead",
  "EventSignupRead",
  "EventSignupUpsertRequest",
  "EventStatus",
  "EventType",
  "EventUpdateRequest",
  "HTTPValidationError",
  "LiveBoardRead",
  "MatchCreateRequest",
  "MatchDetailsCreateRequest",
  "MatchDetailsRead",
  "MatchDetailsUpdateRequest",
  "MatchEntryType",
  "MatchLogEntryCreateRequest",
  "MatchLogEntryRead",
  "MatchResult",
  "MatchSummaryRead",
  "MemberCandidateRead",
  "MembershipCreateRequest",
  "MembershipRead",
  "MembershipRole",
  "MembershipStatus",
  "MembershipUpdateRequest",
  "NotificationRead",
  "NotificationType",
  "OrganizationRead",
  "RedemptionCreateRequest",
  "RedemptionRead",
  "RedemptionStatus",
  "SignupBoardRow",
  "SignupStatus",
  "StoreItemCreateRequest",
  "StoreItemRead",
  "StoreItemUpdateRequest",
  "TeamAnnouncementRequest",
  "TeamHomeRead",
  "TeamRead",
  "TeamSearchResultRead",
  "TeamStatus",
  "TeamUpdateRequest",
  "UnreadCountRead",
  "UserRead",
  "UserStatus",
  "UserSummary",
  "UserSyncRequest",
  "UserUpdateRequest",
  "ValidationError"
] as const;

export const apiEndpoints = [
  {
    "operationId": "sync_current_user_api_v1_auth_sync_post",
    "method": "POST",
    "path": "/api/v1/auth/sync",
    "requestBody": "UserSyncRequest",
    "response": "UserRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "patch_coin_rule_api_v1_coin_rules__coin_rule_id__patch",
    "method": "PATCH",
    "path": "/api/v1/coin-rules/{coin_rule_id}",
    "requestBody": "CoinRuleUpdateRequest",
    "response": "CoinRuleRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "put_device_token_api_v1_device_tokens_put",
    "method": "PUT",
    "path": "/api/v1/device-tokens",
    "requestBody": "DeviceTokenUpsertRequest",
    "response": "DeviceTokenRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "delete_device_token_api_v1_device_tokens__device_token_id__delete",
    "method": "DELETE",
    "path": "/api/v1/device-tokens/{device_token_id}",
    "requestBody": null,
    "response": "void",
    "statusCodes": [
      204,
      422
    ]
  },
  {
    "operationId": "delete_event_route_api_v1_events__event_id__delete",
    "method": "DELETE",
    "path": "/api/v1/events/{event_id}",
    "requestBody": null,
    "response": "void",
    "statusCodes": [
      204,
      422
    ]
  },
  {
    "operationId": "read_event_api_v1_events__event_id__get",
    "method": "GET",
    "path": "/api/v1/events/{event_id}",
    "requestBody": null,
    "response": "EventRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "patch_event_api_v1_events__event_id__patch",
    "method": "PATCH",
    "path": "/api/v1/events/{event_id}",
    "requestBody": "EventUpdateRequest",
    "response": "EventRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_complete_event_api_v1_events__event_id__complete_post",
    "method": "POST",
    "path": "/api/v1/events/{event_id}/complete",
    "requestBody": "EventCompletionRequest",
    "response": "EventCompletionRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_live_board_api_v1_events__event_id__live_board_get",
    "method": "GET",
    "path": "/api/v1/events/{event_id}/live-board",
    "requestBody": null,
    "response": "LiveBoardRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_match_logs_api_v1_events__event_id__match_logs_get",
    "method": "GET",
    "path": "/api/v1/events/{event_id}/match-logs",
    "requestBody": null,
    "response": "MatchLogEntryRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_match_log_api_v1_events__event_id__match_logs_post",
    "method": "POST",
    "path": "/api/v1/events/{event_id}/match-logs",
    "requestBody": "MatchLogEntryCreateRequest",
    "response": "MatchLogEntryRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_my_signup_api_v1_events__event_id__signup_get",
    "method": "GET",
    "path": "/api/v1/events/{event_id}/signup",
    "requestBody": null,
    "response": "EventSignupRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "put_my_signup_api_v1_events__event_id__signup_put",
    "method": "PUT",
    "path": "/api/v1/events/{event_id}/signup",
    "requestBody": "EventSignupUpsertRequest",
    "response": "EventSignupRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_signups_api_v1_events__event_id__signups_get",
    "method": "GET",
    "path": "/api/v1/events/{event_id}/signups",
    "requestBody": null,
    "response": "EventSignupRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_match_summary_api_v1_events__event_id__summary_get",
    "method": "GET",
    "path": "/api/v1/events/{event_id}/summary",
    "requestBody": null,
    "response": "MatchSummaryRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "delete_match_log_route_api_v1_match_logs__log_id__delete",
    "method": "DELETE",
    "path": "/api/v1/match-logs/{log_id}",
    "requestBody": null,
    "response": "void",
    "statusCodes": [
      204,
      422
    ]
  },
  {
    "operationId": "read_notifications_api_v1_notifications_get",
    "method": "GET",
    "path": "/api/v1/notifications",
    "requestBody": null,
    "response": "NotificationRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_unread_count_api_v1_notifications_unread_count_get",
    "method": "GET",
    "path": "/api/v1/notifications/unread-count",
    "requestBody": null,
    "response": "UnreadCountRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_notification_read_api_v1_notifications__notification_id__read_post",
    "method": "POST",
    "path": "/api/v1/notifications/{notification_id}/read",
    "requestBody": null,
    "response": "NotificationRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_my_organizations_api_v1_organizations_get",
    "method": "GET",
    "path": "/api/v1/organizations",
    "requestBody": null,
    "response": "OrganizationRead[]",
    "statusCodes": [
      200
    ]
  },
  {
    "operationId": "post_cancel_redemption_api_v1_redemptions__redemption_id__cancel_post",
    "method": "POST",
    "path": "/api/v1/redemptions/{redemption_id}/cancel",
    "requestBody": null,
    "response": "RedemptionRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_fulfill_redemption_api_v1_redemptions__redemption_id__fulfill_post",
    "method": "POST",
    "path": "/api/v1/redemptions/{redemption_id}/fulfill",
    "requestBody": null,
    "response": "RedemptionRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_refund_redemption_api_v1_redemptions__redemption_id__refund_post",
    "method": "POST",
    "path": "/api/v1/redemptions/{redemption_id}/refund",
    "requestBody": null,
    "response": "RedemptionRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_store_item_api_v1_store_items__store_item_id__get",
    "method": "GET",
    "path": "/api/v1/store-items/{store_item_id}",
    "requestBody": null,
    "response": "StoreItemRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "patch_store_item_api_v1_store_items__store_item_id__patch",
    "method": "PATCH",
    "path": "/api/v1/store-items/{store_item_id}",
    "requestBody": "StoreItemUpdateRequest",
    "response": "StoreItemRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_my_teams_api_v1_teams_get",
    "method": "GET",
    "path": "/api/v1/teams",
    "requestBody": null,
    "response": "TeamRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_team_search_api_v1_teams_search_get",
    "method": "GET",
    "path": "/api/v1/teams/search",
    "requestBody": null,
    "response": "TeamSearchResultRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_team_api_v1_teams__team_id__get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}",
    "requestBody": null,
    "response": "TeamRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "patch_team_api_v1_teams__team_id__patch",
    "method": "PATCH",
    "path": "/api/v1/teams/{team_id}",
    "requestBody": "TeamUpdateRequest",
    "response": "TeamRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_team_announcement_api_v1_teams__team_id__announcements_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/announcements",
    "requestBody": "TeamAnnouncementRequest",
    "response": "NotificationRead[]",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_coin_rules_api_v1_teams__team_id__coin_rules_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/coin-rules",
    "requestBody": null,
    "response": "CoinRuleRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_coin_rule_api_v1_teams__team_id__coin_rules_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/coin-rules",
    "requestBody": "CoinRuleCreateRequest",
    "response": "CoinRuleRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "post_coin_transaction_api_v1_teams__team_id__coin_transactions_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/coin-transactions",
    "requestBody": "CoinTransactionCreateRequest",
    "response": "CoinTransactionRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_coin_balance_api_v1_teams__team_id__coins_balance_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/coins/balance",
    "requestBody": null,
    "response": "CoinBalanceRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_my_coin_transactions_api_v1_teams__team_id__coins_transactions_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/coins/transactions",
    "requestBody": null,
    "response": "CoinTransactionRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_events_api_v1_teams__team_id__events_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/events",
    "requestBody": null,
    "response": "EventRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_event_api_v1_teams__team_id__events_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/events",
    "requestBody": "EventCreateRequest",
    "response": "EventRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_team_home_api_v1_teams__team_id__home_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/home",
    "requestBody": null,
    "response": "TeamHomeRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_join_request_api_v1_teams__team_id__join_requests_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/join-requests",
    "requestBody": null,
    "response": "MembershipRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_match_api_v1_teams__team_id__matches_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/matches",
    "requestBody": "MatchCreateRequest",
    "response": "EventRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_member_candidates_api_v1_teams__team_id__member_candidates_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/member-candidates",
    "requestBody": null,
    "response": "MemberCandidateRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_members_api_v1_teams__team_id__members_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/members",
    "requestBody": null,
    "response": "MembershipRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_member_api_v1_teams__team_id__members_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/members",
    "requestBody": "MembershipCreateRequest",
    "response": "MembershipRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_member_api_v1_teams__team_id__members__user_id__get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/members/{user_id}",
    "requestBody": null,
    "response": "MembershipRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "patch_member_api_v1_teams__team_id__members__user_id__patch",
    "method": "PATCH",
    "path": "/api/v1/teams/{team_id}/members/{user_id}",
    "requestBody": "MembershipUpdateRequest",
    "response": "MembershipRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_member_coin_transactions_api_v1_teams__team_id__members__user_id__coin_transactions_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/members/{user_id}/coin-transactions",
    "requestBody": null,
    "response": "CoinTransactionRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_my_redemptions_api_v1_teams__team_id__redemptions_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/redemptions",
    "requestBody": null,
    "response": "RedemptionRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_redemption_api_v1_teams__team_id__redemptions_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/redemptions",
    "requestBody": "RedemptionCreateRequest",
    "response": "RedemptionRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_team_redemptions_api_v1_teams__team_id__redemptions_manage_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/redemptions/manage",
    "requestBody": null,
    "response": "RedemptionRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_signup_board_api_v1_teams__team_id__signup_board_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/signup-board",
    "requestBody": null,
    "response": "SignupBoardRow[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "read_store_items_api_v1_teams__team_id__store_items_get",
    "method": "GET",
    "path": "/api/v1/teams/{team_id}/store-items",
    "requestBody": null,
    "response": "StoreItemRead[]",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "post_store_item_api_v1_teams__team_id__store_items_post",
    "method": "POST",
    "path": "/api/v1/teams/{team_id}/store-items",
    "requestBody": "StoreItemCreateRequest",
    "response": "StoreItemRead",
    "statusCodes": [
      201,
      422
    ]
  },
  {
    "operationId": "read_current_user_api_v1_users_me_get",
    "method": "GET",
    "path": "/api/v1/users/me",
    "requestBody": null,
    "response": "UserRead",
    "statusCodes": [
      200
    ]
  },
  {
    "operationId": "update_current_user_api_v1_users_me_patch",
    "method": "PATCH",
    "path": "/api/v1/users/me",
    "requestBody": "UserUpdateRequest",
    "response": "UserRead",
    "statusCodes": [
      200,
      422
    ]
  },
  {
    "operationId": "health_health_get",
    "method": "GET",
    "path": "/health",
    "requestBody": null,
    "response": "Response Health Health Get",
    "statusCodes": [
      200
    ]
  }
] as const;

export type ApiSchemaName = (typeof apiSchemaNames)[number];
export type ApiEndpoint = (typeof apiEndpoints)[number];
export type ApiOperationId = ApiEndpoint["operationId"];
export type ApiPath = ApiEndpoint["path"];
export type ApiMethod = ApiEndpoint["method"];
