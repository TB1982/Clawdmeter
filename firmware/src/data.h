#pragma once
#include <Arduino.h>

struct UsageData {
    float session_pct;       // utilization 0-100 (5h window Pro/Max; spending % Enterprise)
    int session_reset_mins;  // minutes until reset
    float weekly_pct;        // 7-day utilization (Pro/Max only; 0 for Enterprise)
    int weekly_reset_mins;   // minutes until weekly reset (Pro/Max only)
    char status[16];         // "allowed", "limited", etc.
    bool chime;              // play the session-reset chime; false unless daemon opts in
    bool enterprise;         // true = Enterprise spending-limit account
    int time_pct;            // 0-100: fraction of billing period elapsed (Enterprise)
    int period_days;         // total billing period length in days (Enterprise)
    char reset_date[12];     // formatted reset date e.g. "Jul 1" (Enterprise)
    long clock_epoch;        // local wall-clock epoch (s) from daemon; 0 = not provided
    int  clock_fmt;          // 12 or 24 (hour format from daemon); defaults to 24
    // Weather, from the daemon's `weather = LAT,LON` setting. The device does
    // no networking of its own — same arrangement as clock_epoch above, and for
    // the same reason: the host already has the network, the credentials and a
    // maintained timezone database, and the device has none of those.
    //
    // weather_code is a WMO code (0 clear, 3 overcast, 61 rain, 95 storm, ...)
    // and is sent raw rather than pre-classified, so what counts as "rain
    // enough to change the animation" stays a device decision.
    int   weather_code;      // WMO weather code; -1 = no weather in this payload
    float weather_temp;      // degrees C; meaningless unless weather_code >= 0
    bool ok;                 // data parse succeeded
    bool valid;              // false until first successful parse
};
