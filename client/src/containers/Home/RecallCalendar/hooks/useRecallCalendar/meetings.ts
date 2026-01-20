import type { CalendarMeeting } from "./models";
import { makeRequest, buildUrl } from "./api";
import { track } from "../../../../../utils/telemetry";

export enum MeetingsActionKind {
  FETCH_START = "FETCH_START",
  FETCH_SUCCESS = "FETCH_SUCCESS",
  FETCH_ERROR = "FETCH_ERROR",
  FETCH_FINISH = "FETCH_FINISH",

  REFRESH_START = "REFRESH_START",
  REFRESH_SUCCESS = "REFRESH_SUCCESS",
  REFRESH_ERROR = "REFRESH_ERROR",
  REFRESH_FINISH = "REFRESH_FINISH",

  RECORD_MEETING_START = "RECORD_MEETING_START",
  RECORD_MEETING_SUCCESS = "RECORD_MEETING_SUCCESS",
  RECORD_MEETING_ERROR = "RECORD_MEETING_ERROR",
  RECORD_MEETING_FINISH = "RECORD_MEETING_FINISH",
}

export type MeetingsState = {
  data?: CalendarMeeting[];
  loading: boolean;
  refresh: boolean;
  error?: Error;
};

export type MeetingsAction = {
  type: MeetingsActionKind;
  meetings?: CalendarMeeting[];
  error?: Error;
  meetingId?: string;
  meeting?: CalendarMeeting;
};

export const MEETINGS_INITIAL_STATE = {
  loading: true,
  refresh: false,
};

export function meetingsReducer(state: MeetingsState, action: MeetingsAction) {
  const { type } = action;

  switch (type) {
    case MeetingsActionKind.FETCH_START:
      return { ...state, loading: true };
    case MeetingsActionKind.FETCH_FINISH:
      return { ...state, loading: false };
    case MeetingsActionKind.REFRESH_START:
      return { ...state, refresh: true };
    case MeetingsActionKind.REFRESH_FINISH:
      return { ...state, refresh: false };

    case MeetingsActionKind.FETCH_SUCCESS:
    case MeetingsActionKind.REFRESH_SUCCESS:
      return { ...state, data: action.meetings, error: undefined };

    case MeetingsActionKind.FETCH_ERROR:
    case MeetingsActionKind.REFRESH_ERROR:
      return { ...state, error: action.error, data: undefined };

    case MeetingsActionKind.RECORD_MEETING_SUCCESS:
      return {
        ...state,
        data: state.data
          ? state.data.map((meeting: CalendarMeeting) => {
              return meeting.id === action.meeting?.id
                ? action.meeting
                : meeting;
            })
          : undefined,
      };

    default:
      return state;
  }
}

type FetchMeetingsArgs = {
  meetingsDispatch: (action: MeetingsAction) => void;
  authToken: string;
};

export async function fetchMeetings({
  meetingsDispatch,
  authToken,
}: FetchMeetingsArgs) {
  // #region agent log
  const fetchStartTime = Date.now();
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meetings.ts:89',message:'fetchMeetings START',data:{hypothesisId:'A'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1'})}).catch(()=>{});
  // #endregion
  meetingsDispatch({ type: MeetingsActionKind.FETCH_START });
  try {
    // #region agent log
    const apiRequestStartTime = Date.now();
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meetings.ts:93',message:'API request START',data:{hypothesisId:'B',url:buildUrl("meetings/")},timestamp:Date.now(),sessionId:'debug-session',runId:'run1'})}).catch(()=>{});
    // #endregion
    const response = await makeRequest<CalendarMeeting[]>({
      token: authToken,
      url: buildUrl("meetings/"),
      method: "GET",
    });
    // #region agent log
    const apiRequestEndTime = Date.now();
    const apiResponseTime = apiRequestEndTime - apiRequestStartTime;
    const responseSize = JSON.stringify(response).length;
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meetings.ts:96',message:'API request END',data:{hypothesisId:'B',responseTimeMs:apiResponseTime,responseSizeBytes:responseSize,meetingCount:Array.isArray(response)?response.length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1'})}).catch(()=>{});
    // #endregion
    const meetings = Array.isArray(response) ? response : [];

    track("meetings.api_received", {
      totalMeetings: meetings.length,
    });

    meetingsDispatch({
      type: MeetingsActionKind.FETCH_SUCCESS,
      meetings,
    });
    // #region agent log
    const fetchEndTime = Date.now();
    const totalFetchTime = fetchEndTime - fetchStartTime;
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meetings.ts:105',message:'fetchMeetings SUCCESS',data:{hypothesisId:'A',totalTimeMs:totalFetchTime,meetingCount:meetings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1'})}).catch(()=>{});
    // #endregion
  } catch (err) {
    // #region agent log
    const fetchEndTime = Date.now();
    const totalFetchTime = fetchEndTime - fetchStartTime;
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meetings.ts:109',message:'fetchMeetings ERROR',data:{hypothesisId:'A',totalTimeMs:totalFetchTime,error:err instanceof Error?err.message:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1'})}).catch(()=>{});
    // #endregion
    meetingsDispatch({
      type: MeetingsActionKind.FETCH_ERROR,
      error: err as Error,
    });
  }
  meetingsDispatch({ type: MeetingsActionKind.FETCH_FINISH });
}

export async function refreshMeetings({
  meetingsDispatch,
  authToken,
}: FetchMeetingsArgs) {
  meetingsDispatch({ type: MeetingsActionKind.REFRESH_START });
  try {
    const response = await makeRequest<CalendarMeeting[]>({
      token: authToken,
      url: buildUrl("meetings/refresh"),
      method: "POST",
    });

    const meetings = Array.isArray(response) ? response : [];

    meetingsDispatch({
      type: MeetingsActionKind.REFRESH_SUCCESS,
      meetings,
    });
  } catch (err) {
    meetingsDispatch({
      type: MeetingsActionKind.REFRESH_ERROR,
      error: err as Error,
    });
  }
  meetingsDispatch({ type: MeetingsActionKind.REFRESH_FINISH });
}

type UpdateMeetingArgs = {
  meetingsDispatch: (action: MeetingsAction) => void;
  authToken: string;
  meetingId: string;
  overrideShouldRecord: boolean;
};

let meetingUpdateInProgressMap: { [k: string]: boolean } = {};

export async function updateMeeting({
  meetingsDispatch,
  meetingId,
  authToken,
  overrideShouldRecord
}: UpdateMeetingArgs) {
  if (meetingUpdateInProgressMap[meetingId]) {
    return;
  }

  meetingUpdateInProgressMap[meetingId] = true;
  meetingsDispatch({ type: MeetingsActionKind.RECORD_MEETING_START });
  try {
    const response = await makeRequest<CalendarMeeting>({
      token: authToken,
      url: buildUrl(`meetings/${meetingId}/`),
      method: "PUT",
      data: { override_should_record: overrideShouldRecord }
    });

    if (response?.id) {
      meetingsDispatch({
        type: MeetingsActionKind.RECORD_MEETING_SUCCESS,
        meeting: response,
      });
    }
  } catch (err) {
    meetingsDispatch({
      type: MeetingsActionKind.RECORD_MEETING_ERROR,
      error: err as Error,
    });
  }
  meetingsDispatch({ type: MeetingsActionKind.RECORD_MEETING_FINISH });
  delete meetingUpdateInProgressMap[meetingId];
}
