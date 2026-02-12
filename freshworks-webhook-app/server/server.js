"use strict";

/**
 * Freshdesk Webhook App - Server Events
 *
 * Listens to ticket events (create, update, new conversation) and forwards
 * them to a configured webhook URL (e.g. n8n) when the ticket belongs to
 * the configured group (or all groups if no filter is set).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseWebhookUrl(url) {
  var parsed = new URL(url);
  return {
    host: parsed.host,
    path: parsed.pathname + parsed.search
  };
}

function buildPayload(eventType, data, iparams) {
  return JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    account: iparams.freshdesk_subdomain + ".freshdesk.com",
    filtered_group: iparams.selected_group_name || "All Groups",
    data: data
  });
}

function shouldTrigger(ticketData, iparams) {
  // If no group filter is configured, trigger for all tickets
  if (!iparams.selected_group_id) {
    return true;
  }
  // Check if the ticket's group_id matches the configured group
  var ticketGroupId = ticketData.group_id || (ticketData.ticket && ticketData.ticket.group_id);
  return String(ticketGroupId) === String(iparams.selected_group_id);
}

function sendWebhook($request, iparams, eventType, eventData) {
  if (!iparams.webhook_url) {
    console.error("No webhook URL configured. Skipping.");
    return;
  }

  var ticketData = eventData.ticket || eventData.conversation || eventData;

  if (!shouldTrigger(ticketData, iparams)) {
    console.info(
      "Ticket group_id (" + (ticketData.group_id || "none") + ") " +
      "does not match configured group (" + iparams.selected_group_id + "). Skipping webhook."
    );
    return;
  }

  var urlParts = parseWebhookUrl(iparams.webhook_url);
  var payload = buildPayload(eventType, eventData, iparams);

  $request.invokeTemplate("sendWebhook", {
    context: {
      webhook_host: urlParts.host,
      webhook_path: urlParts.path,
      payload: payload
    }
  }).then(
    function () {
      console.info("Webhook sent successfully for event: " + eventType);
    },
    function (error) {
      console.error("Webhook failed for event: " + eventType, error);
    }
  );
}

// ── Event Handlers ───────────────────────────────────────────────────────────

exports = {
  /**
   * Fired when a new ticket is created in Freshdesk.
   */
  onTicketCreate: function (payload) {
    sendWebhook(
      this.$request,
      payload.iparams,
      "ticket_created",
      payload.data
    );
  },

  /**
   * Fired when a ticket is updated (status, priority, group, assignee,
   * custom fields, or any other ticket property change).
   */
  onTicketUpdate: function (payload) {
    sendWebhook(
      this.$request,
      payload.iparams,
      "ticket_updated",
      payload.data
    );
  },

  /**
   * Fired when a new reply/note/conversation is added to a ticket.
   */
  onConversationCreate: function (payload) {
    // For conversations, the ticket info may be nested differently.
    // We still check group filtering against the parent ticket.
    var data = payload.data;

    // If conversation payload includes ticket data, use that for group check
    if (data.conversation && data.conversation.ticket_id && !data.ticket) {
      // The conversation payload may not include full ticket data.
      // Send it through — the group filter checks data.ticket.group_id
      // which may be absent. If selected_group_id is set and there's no
      // ticket.group_id in the payload, it won't match and will be skipped.
      // For broader coverage, send conversations regardless of group filter
      // when ticket data isn't available.
    }

    sendWebhook(
      this.$request,
      payload.iparams,
      "conversation_created",
      data
    );
  }
};
