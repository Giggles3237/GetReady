export function registerIntegrationRoutes(app, { requireBopchipboardKey, createVehicleRecord }) {
  app.post("/api/integrations/bopchipboard/get-ready", requireBopchipboardKey, async (req, res) => {
    const result = await createVehicleRecord({
      actorUser: null,
      payload: req.body,
      allowAlternateSubmitter: true,
      actionType: "vehicle_created_integration",
      statusLabel: "Get Ready Submitted via bopchipboard",
      integrationSource: "bopchipboard",
      enrichNotes: true
    });

    res.status(201).json(result);
  });
}
