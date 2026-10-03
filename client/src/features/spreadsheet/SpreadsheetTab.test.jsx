// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpreadsheetTab from "./SpreadsheetTab";

afterEach(cleanup);

function vehicle(id, stockNumber, overrides = {}) {
  return {
    id,
    stock_number: stockNumber,
    year: 2026,
    make: "BMW",
    model: "X5",
    color: "Black",
    due_date: "2026-10-04T12:00:00.000Z",
    status: "submitted",
    submitted_by_user_id: "",
    assigned_user_id: "",
    notes: "",
    service_notes: "",
    bodywork_notes: "",
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderSpreadsheet({ vehicles, saveSpreadsheetVehicle = vi.fn(), loadSpreadsheet = vi.fn() }) {
  const props = {
    vehicles,
    users: [],
    error: "",
    successMessage: "",
    loadSpreadsheet,
    saveSpreadsheetVehicle,
    openVehicle: vi.fn()
  };
  const view = render(<SpreadsheetTab {...props} />);

  return {
    ...view,
    rerenderVehicles(nextVehicles) {
      props.vehicles = nextVehicles;
      view.rerender(<SpreadsheetTab {...props} />);
    }
  };
}

function stockInput(stockNumber) {
  return screen.getByLabelText(`Stock number for ${stockNumber}`);
}

function saveButtonFor(stockNumber) {
  return within(stockInput(stockNumber).closest("tr")).getByRole("button", { name: "Save" });
}

function unsavedCount() {
  return document.querySelectorAll(".spreadsheet-summary strong")[1].textContent;
}

describe("SpreadsheetTab draft preservation", () => {
  it("preserves another row's unsaved edit when one row saves and reloads all vehicles", async () => {
    const first = vehicle("a", "A100");
    const second = vehicle("b", "B200");
    const saveSpreadsheetVehicle = vi.fn().mockResolvedValue(first);
    const view = renderSpreadsheet({ vehicles: [first, second], saveSpreadsheetVehicle });

    fireEvent.change(stockInput("A100"), { target: { value: "A101" } });
    fireEvent.change(stockInput("B200"), { target: { value: "B201" } });
    fireEvent.click(saveButtonFor("A100"));

    await waitFor(() => expect(saveSpreadsheetVehicle).toHaveBeenCalledWith("a", { stock_number: "A101" }));
    view.rerenderVehicles([vehicle("a", "A101"), second]);

    await waitFor(() => expect(stockInput("B200").value).toBe("B201"));
    expect(unsavedCount()).toBe("1");
  });

  it("keeps edits made while a save is in flight dirty after the saved response reloads", async () => {
    const original = vehicle("a", "A100");
    const inFlight = deferred();
    const saveSpreadsheetVehicle = vi.fn().mockReturnValue(inFlight.promise);
    const view = renderSpreadsheet({ vehicles: [original], saveSpreadsheetVehicle });

    fireEvent.change(stockInput("A100"), { target: { value: "A101" } });
    fireEvent.click(saveButtonFor("A100"));
    fireEvent.change(stockInput("A100"), { target: { value: "A100" } });
    view.rerenderVehicles([vehicle("a", "A101")]);
    inFlight.resolve();

    await waitFor(() => expect(stockInput("A101").value).toBe("A100"));
    expect(saveButtonFor("A101").disabled).toBe(false);
  });

  it("retains a failed draft and allows it to be saved again", async () => {
    const original = vehicle("a", "A100");
    const saveSpreadsheetVehicle = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce(original);
    renderSpreadsheet({ vehicles: [original], saveSpreadsheetVehicle });

    fireEvent.change(stockInput("A100"), { target: { value: "A101" } });
    fireEvent.click(saveButtonFor("A100"));

    await waitFor(() => expect(saveButtonFor("A100").disabled).toBe(false));
    expect(stockInput("A100").value).toBe("A101");
    fireEvent.click(saveButtonFor("A100"));

    await waitFor(() => expect(saveSpreadsheetVehicle).toHaveBeenCalledTimes(2));
    expect(saveSpreadsheetVehicle).toHaveBeenLastCalledWith("a", { stock_number: "A101" });
  });

  it("deduplicates repeated clicks during a save and permits a later save", async () => {
    const original = vehicle("a", "A100");
    const inFlight = deferred();
    const saveSpreadsheetVehicle = vi.fn()
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValueOnce(original);
    const view = renderSpreadsheet({ vehicles: [original], saveSpreadsheetVehicle });

    fireEvent.change(stockInput("A100"), { target: { value: "A101" } });
    const saveButton = saveButtonFor("A100");
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    expect(saveSpreadsheetVehicle).toHaveBeenCalledTimes(1);

    view.rerenderVehicles([vehicle("a", "A101")]);
    inFlight.resolve();
    await waitFor(() => expect(unsavedCount()).toBe("0"));

    fireEvent.change(stockInput("A101"), { target: { value: "A102" } });
    fireEvent.click(saveButtonFor("A101"));
    await waitFor(() => expect(saveSpreadsheetVehicle).toHaveBeenCalledTimes(2));
  });

  it("snapshots every dirty row for Save All and preserves newer edits for a follow-up save", async () => {
    const first = vehicle("a", "A100");
    const second = vehicle("b", "B200");
    const firstSave = deferred();
    const saveSpreadsheetVehicle = vi.fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(second);
    const view = renderSpreadsheet({ vehicles: [first, second], saveSpreadsheetVehicle });

    fireEvent.change(stockInput("A100"), { target: { value: "A101" } });
    fireEvent.change(stockInput("B200"), { target: { value: "B201" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 2" }));
    fireEvent.change(stockInput("B200"), { target: { value: "B202" } });

    view.rerenderVehicles([vehicle("a", "A101"), second]);
    firstSave.resolve();
    await waitFor(() => expect(saveSpreadsheetVehicle).toHaveBeenCalledTimes(2));
    expect(saveSpreadsheetVehicle).toHaveBeenNthCalledWith(2, "b", { stock_number: "B201" });

    view.rerenderVehicles([vehicle("a", "A101"), vehicle("b", "B201")]);
    await waitFor(() => expect(stockInput("B201").value).toBe("B202"));
    expect(saveButtonFor("B201").disabled).toBe(false);
  });

  it("continues Save All after a failed row and leaves that row available for retry", async () => {
    const first = vehicle("a", "A100");
    const second = vehicle("b", "B200");
    const saveSpreadsheetVehicle = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce(vehicle("b", "B201"));
    const view = renderSpreadsheet({ vehicles: [first, second], saveSpreadsheetVehicle });

    fireEvent.change(stockInput("A100"), { target: { value: "A101" } });
    fireEvent.change(stockInput("B200"), { target: { value: "B201" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 2" }));

    await waitFor(() => expect(saveSpreadsheetVehicle).toHaveBeenCalledTimes(2));
    view.rerenderVehicles([first, vehicle("b", "B201")]);
    await waitFor(() => expect(unsavedCount()).toBe("1"));
    expect(stockInput("A100").value).toBe("A101");
    expect(saveButtonFor("A100").disabled).toBe(false);
  });

  it("preserves unsaved drafts when Refresh replaces the vehicle list", async () => {
    const original = vehicle("a", "A100");
    const loadSpreadsheet = vi.fn();
    const view = renderSpreadsheet({ vehicles: [original], loadSpreadsheet });

    fireEvent.change(stockInput("A100"), { target: { value: "A101" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(loadSpreadsheet).toHaveBeenCalledTimes(1);

    view.rerenderVehicles([vehicle("a", "A100", { color: "White" })]);
    await waitFor(() => expect(stockInput("A100").value).toBe("A101"));
    expect(within(stockInput("A100").closest("tr")).getByDisplayValue("White")).toBeTruthy();
  });
});
