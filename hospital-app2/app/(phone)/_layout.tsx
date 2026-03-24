// app/(phone)/_layout.tsx
import React from "react";
import { Slot } from "expo-router";
import PhoneFrame from "../../components/shell/PhoneFrame";
import NavDataInit from "../../components/data/NavDataInit";
import TrackingInit from "../../components/data/TrackingInit";
import AppScaffold from "../../components/shell/AppScaffold";

export default function PhoneLayout() {
  return (
    <PhoneFrame>
      <NavDataInit />
      <TrackingInit />
      <AppScaffold>
        <Slot />
      </AppScaffold>
    </PhoneFrame>
  );
}
