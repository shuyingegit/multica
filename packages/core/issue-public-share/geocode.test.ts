import { describe, expect, it } from "vitest";
import {
  formatCoords,
  formatZhAdminAreas,
  parseStoredCoords,
} from "./geocode";

describe("formatZhAdminAreas", () => {
  it("joins province·city·district when all present", () => {
    expect(
      formatZhAdminAreas({
        province: "江苏省",
        city: "无锡市",
        district: "滨湖区",
        countryCode: "CN",
      }),
    ).toBe("江苏省·无锡市·滨湖区");
  });

  it("accepts province+city without a road", () => {
    expect(
      formatZhAdminAreas({
        province: "江苏省",
        city: "无锡市",
        countryCode: "CN",
      }),
    ).toBe("江苏省·无锡市");
  });

  it("drops redundant city=province duplicates", () => {
    expect(
      formatZhAdminAreas({
        province: "上海市",
        city: "上海市",
        district: "浦东新区",
        countryCode: "CN",
      }),
    ).toBe("上海市·浦东新区");
  });
});

describe("parseStoredCoords / formatCoords", () => {
  it("round-trips north-east coordinates", () => {
    const label = formatCoords(31.475, 120.349);
    expect(label).toBe("北纬31.475 东经120.349");
    expect(parseStoredCoords(label)).toEqual({ lat: 31.475, lon: 120.349 });
  });

  it("returns null for place names", () => {
    expect(parseStoredCoords("江苏省·无锡市·滨湖区")).toBeNull();
  });
});
