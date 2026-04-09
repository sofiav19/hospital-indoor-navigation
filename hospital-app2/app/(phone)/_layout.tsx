// app/(phone)/_layout.tsx
import React from "react";
import { Slot } from "expo-router";
import NavDataInit from "../../components/data/NavDataInit";
import TrackingInit from "../../components/data/TrackingInit";
import AppScaffold from "../../components/shell/AppScaffold";

export default function PhoneLayout() {
  return (
    <AppScaffold>
      <NavDataInit />
      <TrackingInit />
      <Slot />
    </AppScaffold>
  );
}
