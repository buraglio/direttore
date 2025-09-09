#!/usr/bin/env python3

from flask import Flask, Response
from ics import Calendar, Event
import datetime

app = Flask(__name__)

@app.route("/schedule.ics")
def ical_feed():
    cal = Calendar()
    # Fetch scheduled jobs from DB (simplified MVP: hardcode for now)
    jobs = [
        {"name": "BGP Test", "start": "2025-09-09 02:00", "duration": "00:30"},
        {"name": "Firewall Audit", "start": "2025-09-10 22:00", "duration": "01:00"}
    ]
    for j in jobs:
        e = Event(
            name=j["name"],
            begin=datetime.datetime.strptime(j["start"], "%Y-%m-%d %H:%M"),
            duration=datetime.timedelta(hours=int(j["duration"].split(":")[0]))
        )
        cal.events.add(e)
    return Response(cal.serialize(), mimetype="text/calendar")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
