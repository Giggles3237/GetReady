import { v4 as uuid } from "uuid";
import nodemailer from "nodemailer";
import { getPool, insertNotificationDelivery, listNotificationRules, listUsers } from "../db.js";
import { getPipelineColumn, STATUS_META } from "../workflow.js";

let transporter;

function getEmailTransporter() {
  if (transporter !== undefined) {
    return transporter;
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER || process.env.SMTP_PASSWORD
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      : undefined
  });

  return transporter;
}

function formatDueDate(value) {
  if (!value) {
    return "No due date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function buildVehicleLine(vehicle) {
  return `${vehicle.stock_number} | ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.color ? ` | ${vehicle.color}` : ""}`;
}

function buildEmail({ vehicle, previousBucket, nextBucket, actorUser }) {
  const subject = `Get Ready: ${vehicle.stock_number} moved to ${nextBucket}`;
  const actionLabel = STATUS_META[vehicle.status]?.label ?? vehicle.status;
  const body = [
    `${buildVehicleLine(vehicle)} moved from ${previousBucket} to ${nextBucket}.`,
    "",
    `Current step: ${actionLabel}`,
    `Due: ${formatDueDate(vehicle.due_date)}`,
    `Location: ${vehicle.current_location || nextBucket}`,
    actorUser ? `Updated by: ${actorUser.name}` : "",
    "",
    "Open Get Ready to review the unit and take the next action."
  ].filter((line) => line !== "").join("\n");

  return { subject, text: body };
}

function buildRecipientUsers({ usersById, recipientRules, vehicle }) {
  const recipientIds = new Set(recipientRules.map((rule) => rule.user_id));

  if (vehicle.submitted_by_user_id) {
    recipientIds.add(vehicle.submitted_by_user_id);
  }

  return [...recipientIds]
    .map((userId) => usersById.get(userId))
    .filter((user) => user?.is_active && user.email);
}

async function recordDelivery(delivery) {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await insertNotificationDelivery(connection, delivery);
  } finally {
    connection.release();
  }
}

export async function sendBucketNotifications({ previousVehicle, nextVehicle, actorUserId }) {
  const previousBucket = getPipelineColumn(previousVehicle);
  const nextBucket = getPipelineColumn(nextVehicle);

  if (previousBucket === nextBucket) {
    return null;
  }

  const summary = {
    channel: "email",
    previous_bucket: previousBucket,
    bucket: nextBucket,
    sent: [],
    failed: [],
    skipped_reason: null
  };

  const mailer = getEmailTransporter();
  if (!mailer) {
    console.warn("Skipping bucket email notifications because SMTP_HOST and SMTP_FROM are not configured.");
    return {
      ...summary,
      skipped_reason: "smtp_not_configured"
    };
  }

  const [users, rules] = await Promise.all([
    listUsers(),
    listNotificationRules()
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const actorUser = actorUserId ? usersById.get(actorUserId) ?? null : null;
  const recipientRules = rules.filter((rule) => rule.bucket === nextBucket && Boolean(rule.email_enabled));
  const recipientUsers = buildRecipientUsers({ usersById, recipientRules, vehicle: nextVehicle });
  const { subject, text } = buildEmail({ vehicle: nextVehicle, previousBucket, nextBucket, actorUser });

  for (const user of recipientUsers) {
    const delivery = {
      id: uuid(),
      vehicle_id: nextVehicle.id,
      user_id: user.id,
      bucket: nextBucket,
      channel: "email",
      recipient: user.email,
      status: "pending"
    };

    try {
      const result = await mailer.sendMail({
        from: process.env.SMTP_FROM,
        to: user.email,
        subject,
        text
      });

      await recordDelivery({
        ...delivery,
        status: "sent",
        provider_message_id: result.messageId ?? null
      });
      summary.sent.push({
        user_id: user.id,
        name: user.name,
        email: user.email
      });
    } catch (error) {
      console.error(`Failed to email bucket notification to ${user.email}`, error);
      await recordDelivery({
        ...delivery,
        status: "failed",
        error_message: error.message || "Email send failed."
      });
      summary.failed.push({
        user_id: user.id,
        name: user.name,
        email: user.email,
        message: error.message || "Email send failed."
      });
    }
  }

  if (summary.sent.length === 0 && summary.failed.length === 0) {
    return {
      ...summary,
      skipped_reason: "no_recipients"
    };
  }

  return summary;
}
