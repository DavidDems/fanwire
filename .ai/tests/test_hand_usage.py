"""Hand usage is measured from explicitly selected local transcript metadata.

Claude assistant content chunks repeat the same request/message usage. The
manager's metadata-only investigation found 908 changing duplicate records:
only output_tokens changed, always increasing, and each had a completed
snapshot. They are cumulative streaming measurements, not separate turns.
Counting lines inflates usage; accepting incomplete evidence undercounts it.
Synthetic transcripts pin both boundaries without reading real sessions or
retaining their content, identifiers or filesystem locations.
"""

import copy
import importlib
import json

import pytest


@pytest.fixture
def handusage():
    return importlib.import_module("agentlib.handusage")


def assistant(request="request-private", message="message-private", **tokens):
    return {
        "type": "assistant",
        "requestId": request,
        "sessionId": "session-private",
        "message": {
            "id": message,
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": "TRANSCRIPT_CONTENT_PRIVATE"}],
            "usage": {
                "input_tokens": 10,
                "output_tokens": 3,
                "cache_creation_input_tokens": 20,
                "cache_read_input_tokens": 30,
                **tokens,
            },
        },
    }


def transcript(tmp_path, name, records):
    path = tmp_path / name
    path.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
    return path


def test_capture_counts_unique_requests_across_chunks_and_explicit_subagent_files(
    handusage, tmp_path, capsys
):
    first = assistant()
    chunk = copy.deepcopy(first)
    chunk["message"]["content"] = [{"type": "tool_use", "input": "OTHER_PRIVATE_CONTENT"}]
    parent = transcript(
        tmp_path,
        "private-parent.jsonl",
        [{"type": "user", "message": {"content": "PRIVATE_USER_CONTENT"}}, first, chunk],
    )
    child_record = assistant("child-request-private", "child-message-private", output_tokens=7)
    child_record["isSidechain"] = True
    child = transcript(tmp_path, "private-child.jsonl", [first, child_record])
    # A neighbouring transcript is outside the explicit selection.
    transcript(tmp_path, "unselected.jsonl", [assistant(input_tokens=999)])

    result = handusage.capture([parent, child, parent])

    assert result == {
        "input_tokens": 20,
        "output_tokens": 10,
        "cache_creation_input_tokens": 40,
        "cache_read_input_tokens": 60,
        "num_turns": 2,
        "source": "claude_transcript",
    }
    assert capsys.readouterr() == ("", "")


def test_distinct_request_ids_with_the_same_message_id_are_distinct_turns(handusage, tmp_path):
    path = transcript(tmp_path, "selected.jsonl", [assistant("one"), assistant("two")])
    result = handusage.capture([path])
    assert result["num_turns"] == 2
    assert result["output_tokens"] == 6


def test_reported_zero_tokens_are_known_zero_instead_of_missing_usage(handusage, tmp_path):
    path = transcript(
        tmp_path,
        "selected.jsonl",
        [
            assistant(
                input_tokens=0,
                output_tokens=0,
                cache_creation_input_tokens=0,
                cache_read_input_tokens=0,
            )
        ],
    )
    assert handusage.capture([path]) == {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "num_turns": 1,
        "source": "claude_transcript",
    }


@pytest.mark.parametrize(
    "field",
    ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"],
)
@pytest.mark.parametrize("invalid", [True, -1, 1.5, None, "3"])
def test_each_counter_requires_a_nonnegative_integer(handusage, tmp_path, field, invalid):
    path = transcript(tmp_path, "selected.jsonl", [assistant(**{field: invalid})])
    with pytest.raises(handusage.HandUsageError):
        handusage.capture([path])


@pytest.mark.parametrize(
    "field",
    ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"],
)
def test_an_absent_counter_is_unknown_rather_than_an_implicit_zero(handusage, tmp_path, field):
    record = assistant()
    del record["message"]["usage"][field]
    path = transcript(tmp_path, "selected.jsonl", [record])
    with pytest.raises(handusage.HandUsageError):
        handusage.capture([path])


@pytest.mark.parametrize(
    "mutation",
    [
        lambda record: record.pop("requestId"),
        lambda record: record.update(requestId=""),
        lambda record: record.update(requestId=True),
        lambda record: record["message"].pop("id"),
        lambda record: record["message"].update(id=""),
        lambda record: record["message"].update(id=12),
        lambda record: record["message"].pop("usage"),
        lambda record: record["message"].update(usage=None),
        lambda record: record["message"]["usage"].pop("input_tokens"),
        lambda record: record.update(message="PRIVATE_BROKEN_MESSAGE"),
    ],
)
def test_missing_usage_or_deduplication_identity_refuses_a_partial_total(
    handusage, tmp_path, mutation
):
    broken = assistant("broken-request-private", "broken-message-private")
    mutation(broken)
    path = transcript(tmp_path, "private-selected.jsonl", [assistant(), broken])
    with pytest.raises(handusage.HandUsageError) as caught:
        handusage.capture([path])
    error = str(caught.value)
    assert str(path) not in error and "PRIVATE" not in error
    assert "request-private" not in error and "message-private" not in error


@pytest.mark.parametrize(
    "field", ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
)
def test_conflicting_fixed_usage_is_rejected_without_echoing_evidence(handusage, tmp_path, field):
    path = transcript(tmp_path, "private-selected.jsonl", [assistant(), assistant(**{field: 99})])
    with pytest.raises(handusage.HandUsageError) as caught:
        handusage.capture([path])
    error = str(caught.value)
    for private in (str(path), "TRANSCRIPT_CONTENT_PRIVATE", "request-private", "message-private"):
        assert private not in error


@pytest.mark.parametrize("reverse_files", [False, True])
def test_cumulative_output_snapshots_use_the_completed_maximum_independent_of_file_order(
    handusage, tmp_path, reverse_files
):
    provisional = assistant(output_tokens=2)
    provisional["message"]["stop_reason"] = None
    earlier_complete = assistant(output_tokens=3)
    final = assistant(output_tokens=7)
    first = transcript(tmp_path, "first.jsonl", [provisional, earlier_complete])
    second = transcript(tmp_path, "second.jsonl", [final, provisional, final])
    paths = [second, first] if reverse_files else [first, second]
    result = handusage.capture(paths)
    assert result == {
        "input_tokens": 10,
        "output_tokens": 7,
        "cache_creation_input_tokens": 20,
        "cache_read_input_tokens": 30,
        "num_turns": 1,
        "source": "claude_transcript",
    }


@pytest.mark.parametrize("stop_reason", [None, "", True, 1])
@pytest.mark.parametrize("has_earlier_completion", [False, True])
def test_a_turn_without_a_completed_maximum_is_not_a_measured_total(
    handusage, tmp_path, stop_reason, has_earlier_completion
):
    maximum = assistant(output_tokens=7)
    maximum["message"]["stop_reason"] = stop_reason
    earlier = [assistant(output_tokens=3)] if has_earlier_completion else []
    path = transcript(tmp_path, "selected.jsonl", [*earlier, maximum])
    with pytest.raises(handusage.HandUsageError):
        handusage.capture([path])


@pytest.mark.parametrize("contents", ["", "{PRIVATE_MALFORMED", "{}\n", '{"type":"user"}\n'])
def test_unusable_transcripts_are_unknown_instead_of_zero(handusage, tmp_path, contents):
    path = tmp_path / "private-selected.jsonl"
    path.write_text(contents, encoding="utf-8")
    with pytest.raises(handusage.HandUsageError) as caught:
        handusage.capture([path])
    assert str(path) not in str(caught.value)
    assert "PRIVATE_MALFORMED" not in str(caught.value)


def test_unreadable_or_absent_selection_is_rejected_without_printing_paths(handusage, tmp_path):
    missing = tmp_path / "private-missing.jsonl"
    with pytest.raises(handusage.HandUsageError) as caught:
        handusage.capture([missing])
    assert str(missing) not in str(caught.value)
    with pytest.raises(handusage.HandUsageError):
        handusage.capture([])


def test_a_malformed_line_after_valid_usage_does_not_return_a_partial_total(handusage, tmp_path):
    path = transcript(tmp_path, "selected.jsonl", [assistant()])
    with path.open("a", encoding="utf-8") as stream:
        stream.write("{PRIVATE_PARTIAL_LINE")
    with pytest.raises(handusage.HandUsageError) as caught:
        handusage.capture([path])
    assert "PRIVATE_PARTIAL_LINE" not in str(caught.value)


def test_invalid_utf8_is_a_sanitized_evidence_error(handusage, tmp_path):
    path = tmp_path / "private-selected.jsonl"
    path.write_bytes(b"PRIVATE_INVALID_ENCODING\xff\n")
    with pytest.raises(handusage.HandUsageError) as caught:
        handusage.capture([path])
    assert str(path) not in str(caught.value)
    assert "PRIVATE_INVALID_ENCODING" not in str(caught.value)
