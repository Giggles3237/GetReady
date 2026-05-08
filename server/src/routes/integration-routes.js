import { asyncHandler } from "../async-handler.js";

export function registerIntegrationRoutes(app, { requireBopchipboardKey, createVehicleRecord }) {
  app.post("/api/integrations/bopchipboard/get-ready", requireBopchipboardKey, asyncHandler(async (req, res) => {
    const result = await createVehicleRecord({
      actorUser: null,
      payload: req.body,
      allowAlternateSubmitter: true,
      actionType: "vehicle_created_integration",
      resubmissionActionType: "vehicle_resubmitted_integration",
      statusLabel: "Get Ready Submitted via bopchipboard",
      resubmissionStatusLabel: "Get Ready Resubmitted via bopchipboard",
      integrationSource: "bopchipboard",
      enrichNotes: true
    });

    res.status(result.created ? 201 : 200).json(result);
  }));
}
