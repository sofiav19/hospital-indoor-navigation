// app/(phone)/_layout.tsx
import React from "react";
import { Slot } from "expo-router";
import PhoneFrame from "../../components/shell/PhoneFrame";
import NavDataInit from "../../components/data/NavDataInit";

export default function PhoneLayout() {
  return (
    <PhoneFrame>
      <NavDataInit />
      <Slot />
    </PhoneFrame>
  );
}